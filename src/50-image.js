/**
 * @module 50-image
 * 职责：静态上传管线——类型/字节/像素上限、解码、裁剪、缩放、WebP 编码、data URL 校验；
 *       提供 51-animation 复用的解码/绘制/编码工具（drawImageCropInto 等）。
 * 依赖：contract / status / storage（白名单与静态字符上限）。
 * 被依赖：51-animation / 55-crop / 65-interaction / 80-settings。
 * 状态：M1-4 迁移 0.1.0 已验证管线；M5 起输出固定 256×256（只降质量、不降尺寸）。
 */
const IMAGE_LIMITS = Object.freeze({
  staticInputBytes: 2 * 1024 * 1024,
  maxDimension: 10000,
  maxPixels: 40 * 1000 * 1000,
  outputSide: 256,
  staticMaxDataUrlChars: STATIC_MAX_DATA_URL_CHARS,
  qualities: Object.freeze([0.85, 0.7, 0.6, 0.45])
});

const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

// @chat-avatars-image:start
/** 纯校验：静态类型/字节上限；返回错误码或 null。动图由 51-animation 单独校验。 */
function imageStaticInputError(file) {
  if (!file || IMAGE_TYPES.indexOf(String(file.type || '')) < 0) return 'E_TYPE';
  if (typeof file.size === 'number' && file.size > IMAGE_LIMITS.staticInputBytes) return 'E_SIZE';
  return null;
}

/** 纯校验：像素/边长上限；返回错误码或 null。 */
function imageDimensionsError(width, height) {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return 'E_DECODE';
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension) return 'E_DIMENSIONS';
  if (width * height > IMAGE_LIMITS.maxPixels) return 'E_DIMENSIONS';
  return null;
}

/** 居中方形裁剪矩形；非法尺寸返回 null。 */
function centerCropRect(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side: side };
}

/** 校验并归一化任意裁剪矩形：空 rect 退化为居中裁剪，越界坐标 clamp，side 限 1..min(w,h)。 */
function normalizeCropRect(rect, width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  if (!rect || typeof rect !== 'object') return centerCropRect(width, height);
  const maxSide = Math.min(width, height);
  let side = Math.floor(Number(rect.side));
  if (!isFinite(side) || side <= 0) return null;
  if (side > maxSide) side = maxSide;
  let sx = Math.floor(Number(rect.sx));
  let sy = Math.floor(Number(rect.sy));
  if (!isFinite(sx)) sx = 0;
  if (!isFinite(sy)) sy = 0;
  sx = Math.max(0, Math.min(sx, width - side));
  sy = Math.max(0, Math.min(sy, height - side));
  return { sx: sx, sy: sy, side: side };
}
// @chat-avatars-image:end

/** 从 Blob/File 解码为 ImageBitmap（不可用时回退 Image 元素）。 */
function decodeBlob(blob) {
  return new Promise(function (resolve, reject) {
    function fallback() {
      try {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = function () {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {}
          resolve(image);
        };
        image.onerror = function () {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {}
          reject(makeError('E_DECODE'));
        };
        image.src = url;
      } catch (error) {
        reject(makeError('E_DECODE'));
      }
    }
    try {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(blob).then(resolve, fallback);
      } else {
        fallback();
      }
    } catch (error) {
      fallback();
    }
  });
}

function decodeFile(file) {
  return decodeBlob(file);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(function (resolve) {
    try {
      canvas.toBlob(function (blob) {
        resolve(blob || null);
      }, type, quality);
    } catch (error) {
      resolve(null);
    }
  });
}

function blobToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    try {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(makeError('E_ENCODE'));
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(makeError('E_ENCODE'));
    }
  });
}

/** 关闭解码后的 source（ImageBitmap/VideoFrame 才有 close；Image 元素无副作用）。 */
function closeDecodedSource(source) {
  try {
    if (source && typeof source.close === 'function') source.close();
  } catch (error) {}
}

/** 源尺寸读取：兼容 ImageBitmap / Image / VideoFrame（displayWidth）。 */
function decodedSourceSize(source) {
  if (!source) return { width: 0, height: 0 };
  const width =
    source.width || source.displayWidth || source.naturalWidth || source.codedWidth || 0;
  const height =
    source.height || source.displayHeight || source.naturalHeight || source.codedHeight || 0;
  return { width: width, height: height };
}

/**
 * 将源图指定区域绘制到目标 canvas 的 (dx, dy) 位置（调用方负责 canvas 尺寸与 context 初始化）。
 * 预览与输出共用；rect 为空时居中裁剪。雪碧图烘焙按帧横向偏移复用本函数。
 */
function drawImageCropInto(canvas, source, rect, size, dx, dy) {
  const dimensions = decodedSourceSize(source);
  if (!canvas || !(dimensions.width > 0) || !(dimensions.height > 0)) throw makeError('E_DECODE');
  const crop = normalizeCropRect(rect, dimensions.width, dimensions.height);
  if (!crop) throw makeError('E_DECODE');
  const context = canvas.getContext('2d');
  if (!context) throw makeError('E_ENCODE');
  context.imageSmoothingEnabled = true;
  try {
    context.imageSmoothingQuality = 'high';
  } catch (error) {}
  context.drawImage(
    source,
    crop.sx,
    crop.sy,
    crop.side,
    crop.side,
    Number(dx) || 0,
    Number(dy) || 0,
    size,
    size
  );
  return crop;
}

/** 将源图指定区域绘制到正方形 canvas（宽高都设为 size）；预览与静态输出共用。 */
function drawImageCrop(canvas, source, rect, size) {
  if (!canvas) throw makeError('E_DECODE');
  canvas.width = size;
  canvas.height = size;
  return drawImageCropInto(canvas, source, rect, size, 0, 0);
}

/** 文件 -> 已解码静态 source（含类型/字节/尺寸校验）；调用方负责 closeDecodedSource。 */
function prepareImageFile(file) {
  const inputError = imageStaticInputError(file);
  if (inputError) return Promise.reject(makeError(inputError));
  return decodeFile(file).then(function (source) {
    const dimensions = decodedSourceSize(source);
    const dimensionError = imageDimensionsError(dimensions.width, dimensions.height);
    if (dimensionError) {
      closeDecodedSource(source);
      throw makeError(dimensionError);
    }
    return { source: source, width: dimensions.width, height: dimensions.height };
  });
}

/**
 * source + 裁剪矩形 -> 固定 256px 静态 data URL。
 * 质量阶梯 [0.85, 0.7, 0.6, 0.45] 依次尝试，超字符上限继续降质量；全部失败 E_TOO_LARGE。
 */
function processImageSource(source, rect) {
  return Promise.resolve().then(function () {
    const dimensions = decodedSourceSize(source);
    if (!(dimensions.width > 0) || !(dimensions.height > 0)) throw makeError('E_DECODE');
    const crop = normalizeCropRect(rect, dimensions.width, dimensions.height);
    if (!crop) throw makeError('E_DECODE');
    const side = IMAGE_LIMITS.outputSide;
    const canvas = document.createElement('canvas');
    drawImageCrop(canvas, source, crop, side);
    let chain = Promise.resolve(null);
    for (const quality of IMAGE_LIMITS.qualities) {
      chain = chain.then(function (found) {
        if (found) return found;
        return canvasToBlob(canvas, 'image/webp', quality)
          .then(function (webp) {
            if (webp && webp.type === 'image/webp') return webp;
            return canvasToBlob(canvas, 'image/jpeg', quality);
          })
          .then(function (blob) {
            if (!blob) return null;
            return blobToDataUrl(blob).then(function (dataUrl) {
              if (!validImage(dataUrl)) return null;
              return dataUrl.length <= IMAGE_LIMITS.staticMaxDataUrlChars ? dataUrl : null;
            });
          });
      });
    }
    return chain.then(function (dataUrl) {
      if (!dataUrl) throw makeError('E_TOO_LARGE');
      return dataUrl;
    });
  });
}

/** File -> 256px 居中方形 data URL（兼容入口；裁剪对话框走 prepareAvatarFile + processImageSource）。 */
function processImageFile(file) {
  return prepareImageFile(file).then(function (prepared) {
    return processImageSource(prepared.source, null).then(
      function (dataUrl) {
        closeDecodedSource(prepared.source);
        return dataUrl;
      },
      function (error) {
        closeDecodedSource(prepared.source);
        throw error;
      }
    );
  });
}
