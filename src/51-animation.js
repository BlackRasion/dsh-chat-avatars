/**
 * @module 51-animation
 * 职责：动图头像管线——ImageDecoder 解码 GIF/APNG/动图 WebP、自适应帧采样、横向雪碧图烘焙（WebP）、
 *       超限降级（质量阶梯 → 帧数阶梯）。
 * 依赖：contract / status / storage（上限/合法值）/ image（解码/绘制/编码工具）。
 * 被依赖：55-crop（预览）/ 65-interaction / 80-settings。
 * 状态：M5 新增；非安全上下文（无 ImageDecoder）拒绝动图，静态头像不受影响。
 *
 * 设计：本地开发文档（dev-docs）§3/§4；纯函数在 @chat-avatars-animation 标记区，供源码提取测试。
 */
const ANIM_INPUT_BYTES = 6 * 1024 * 1024;
const ANIM_TARGET_FPS = 12;
const ANIM_MIN_FRAMES = 8;
// M5-4：长动图不再固定 24 帧；最多 96 帧，每帧尺寸按 ANIM_FRAME_SIDES 自适应，优先帧率。
const ANIM_MAX_FRAMES = 96;
// 源动图某帧没有时长信息时按 100ms 处理（GIF/APNG 正常都带时长）。
const ANIM_DEFAULT_FRAME_US = 100000;
// 雪碧图超限时先降帧尺寸，再降质量，最后按此阶梯降帧（只尝试小于当前帧数的档位）。
const ANIM_FRAME_LADDER = Object.freeze([96, 72, 64, 48, 32, 24, 16, 12, 8]);
const ANIM_QUALITY_LADDER = Object.freeze([0.7, 0.55, 0.45]);
// A（2026-10-21）：绘制阶段按累计耗时让出主线程，替代「每帧一次 setTimeout(0)」，减少烘焙总耗时；
// 预算内单个任务仍远小于 50ms 长任务阈值。
const ANIM_YIELD_BUDGET_MS = 10;
// A：候选画布像素数达到该阈值时先用最低质量编码探底——大画布编码贵（实测 160px 候选单次 ≥165ms），
// 整档注定超限时先探底可省一次高质量编码。只影响编码顺序，不改变最终选择。
const ANIM_FLOOR_FIRST_PIXELS = 1500000;
// 动图每帧边长候选（静态仍 256）；雪碧图总宽 side×frames 不得超过 ANIM_SPRITE_MAX_WIDTH。
const ANIM_FRAME_SIDES = Object.freeze([256, 192, 160, 128, 96, 64]);
// 浏览器/WebP 实测雪碧图最大宽度；超过时编码体积/尺寸不可靠，直接跳过该候选。
const ANIM_SPRITE_MAX_WIDTH = 16383;
const IMAGE_MIME_BY_FORMAT = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
});

// @chat-avatars-animation:start
function animationByteAt(bytes, index) {
  if (!bytes || typeof bytes.length !== 'number' || index < 0 || index >= bytes.length) return -1;
  return bytes[index];
}

function animationAsciiAt(bytes, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    const value = animationByteAt(bytes, offset + index);
    if (value < 0) return '';
    text += String.fromCharCode(value);
  }
  return text;
}

function animationReadUint32BE(bytes, offset) {
  return (
    (animationByteAt(bytes, offset) * 0x1000000 +
      animationByteAt(bytes, offset + 1) * 0x10000 +
      animationByteAt(bytes, offset + 2) * 0x100 +
      animationByteAt(bytes, offset + 3)) >>>
    0
  );
}

function animationReadUint32LE(bytes, offset) {
  return (
    (animationByteAt(bytes, offset) +
      animationByteAt(bytes, offset + 1) * 0x100 +
      animationByteAt(bytes, offset + 2) * 0x10000 +
      animationByteAt(bytes, offset + 3) * 0x1000000) >>>
    0
  );
}

/** 魔数嗅探图片格式：png/jpeg/gif/webp；未知返回 null。 */
function detectImageFormat(bytes) {
  if (
    animationByteAt(bytes, 0) === 0x89 &&
    animationAsciiAt(bytes, 1, 3) === 'PNG' &&
    animationByteAt(bytes, 4) === 0x0d &&
    animationByteAt(bytes, 5) === 0x0a &&
    animationByteAt(bytes, 6) === 0x1a &&
    animationByteAt(bytes, 7) === 0x0a
  ) {
    return 'png';
  }
  if (
    animationByteAt(bytes, 0) === 0xff &&
    animationByteAt(bytes, 1) === 0xd8 &&
    animationByteAt(bytes, 2) === 0xff
  ) {
    return 'jpeg';
  }
  if (animationAsciiAt(bytes, 0, 3) === 'GIF') return 'gif';
  if (animationAsciiAt(bytes, 0, 4) === 'RIFF' && animationAsciiAt(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** MIME -> 格式名（文件类型可信但魔数缺失时兜底）。 */
function formatFromMime(type) {
  const text = String(type || '');
  if (text === 'image/png') return 'png';
  if (text === 'image/jpeg' || text === 'image/jpg') return 'jpeg';
  if (text === 'image/gif') return 'gif';
  if (text === 'image/webp') return 'webp';
  return null;
}

/** PNG 是否含 acTL 块（APNG 标志）；在 IDAT/IEND 前出现即视为动图。 */
function isAnimatedPng(bytes) {
  if (detectImageFormat(bytes) !== 'png') return false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = animationReadUint32BE(bytes, offset);
    const type = animationAsciiAt(bytes, offset + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    if (!isFinite(length) || length < 0) return false;
    offset += 12 + length;
  }
  return false;
}

/** WebP 是否含 ANIM 块或 VP8X animation 标志位。 */
function isAnimatedWebp(bytes) {
  if (detectImageFormat(bytes) !== 'webp') return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = animationAsciiAt(bytes, offset, 4);
    const size = animationReadUint32LE(bytes, offset + 4);
    if (fourcc === 'ANIM') return true;
    if (fourcc === 'VP8X' && (animationByteAt(bytes, offset + 8) & 0x02) === 0x02) return true;
    if (!isFinite(size) || size < 0) return false;
    offset += 8 + size + (size & 1);
  }
  return false;
}

/** 帧时长归一化：缺失/非正/非数字按 ANIM_DEFAULT_FRAME_US 处理；长度由帧数决定。 */
function normalizeFrameDurations(durations, frameCount) {
  const count =
    Number.isInteger(frameCount) && frameCount > 0
      ? frameCount
      : Array.isArray(durations)
        ? durations.length
        : 0;
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const raw = durations && typeof durations.length === 'number' ? Number(durations[index]) : NaN;
    out.push(isFinite(raw) && raw > 0 ? raw : ANIM_DEFAULT_FRAME_US);
  }
  return out;
}

function totalDurationsUs(durations) {
  let total = 0;
  for (const duration of durations || []) {
    const value = Number(duration);
    if (isFinite(value) && value > 0) total += value;
  }
  return total;
}

/** 中点采样：第 i 帧取 (i+0.5)/frames 处的时间点。 */
function buildSampleTimes(totalUs, frames) {
  const total = Number(totalUs);
  const count = Math.floor(Number(frames) || 0);
  if (!(total > 0) || !(count > 0)) return [];
  const times = [];
  for (let index = 0; index < count; index += 1) {
    times.push(Math.round(((index + 0.5) * total) / count));
  }
  return times;
}

/** 时间点 -> 源帧下标（按累计时长；越界 clamp 到首/尾帧）。 */
function pickFrameIndex(durationsUs, timeUs) {
  const list = Array.isArray(durationsUs) ? durationsUs : [];
  if (list.length === 0) return 0;
  const time = Number(timeUs);
  if (!isFinite(time)) return 0;
  let cumulative = 0;
  for (let index = 0; index < list.length; index += 1) {
    const duration = Number(list[index]);
    cumulative += isFinite(duration) && duration > 0 ? duration : ANIM_DEFAULT_FRAME_US;
    if (time < cumulative) return index;
  }
  return list.length - 1;
}

/** frameMs = round(总时长ms / 帧数)，clamp 到 20–5000。 */
function planFrameMs(totalUs, frames) {
  const count = Math.floor(Number(frames) || 0);
  const total = Number(totalUs);
  if (!(count > 0) || !(total > 0)) return ANIM_FRAME_MS_MIN;
  const ms = Math.round(total / 1000 / count);
  return Math.max(ANIM_FRAME_MS_MIN, Math.min(ANIM_FRAME_MS_MAX, ms));
}

/** 给定帧数生成完整采样计划（降级重采样共用）。 */
function planSamplePlan(durationsUs, frames) {
  const durations = normalizeFrameDurations(durationsUs, Array.isArray(durationsUs) ? durationsUs.length : 0);
  const sourceFrames = durations.length;
  if (sourceFrames < 2) return null;
  const totalUs = totalDurationsUs(durations);
  const requested = Math.floor(Number(frames) || 0);
  const frameCount = Math.min(
    sourceFrames,
    ANIM_MAX_FRAMES,
    Math.max(2, requested || Math.min(ANIM_MIN_FRAMES, sourceFrames))
  );
  if (!(totalUs > 0) || frameCount < 2) return null;
  const frameMs = planFrameMs(totalUs, frameCount);
  const sampleTimesUs = buildSampleTimes(totalUs, frameCount);
  const frameIndices = sampleTimesUs.map(function (timeUs) {
    return pickFrameIndex(durations, timeUs);
  });
  return {
    sourceFrames: sourceFrames,
    totalUs: totalUs,
    frames: frameCount,
    frameMs: frameMs,
    sampleTimesUs: sampleTimesUs,
    frameIndices: frameIndices
  };
}

/**
 * 自适应帧计划：目标 12fps、8–24 帧、中点采样、保留原始总时长。
 * 源帧数 <2 返回 null（调用方按静态处理）。测试素材预期：0.45s→8 帧/56ms；14s→24 帧/583ms。
 */
function planAnimationFrames(durationsUs) {
  const durations = normalizeFrameDurations(durationsUs, Array.isArray(durationsUs) ? durationsUs.length : 0);
  const sourceFrames = durations.length;
  if (sourceFrames < 2) return null;
  const totalUs = totalDurationsUs(durations);
  const rawDesired = Math.round((totalUs / 1000000) * ANIM_TARGET_FPS);
  const lower = Math.min(ANIM_MIN_FRAMES, sourceFrames);
  const desired = Math.min(sourceFrames, Math.max(lower, Math.min(ANIM_MAX_FRAMES, rawDesired)));
  return planSamplePlan(durations, desired);
}

/** 超限降级候选：仅返回小于当前帧数的阶梯档位（24→[16,12,8]；8→[]）。 */
function planDegradeFrames(frames) {
  const current = Math.floor(Number(frames) || 0);
  const out = [];
  for (const candidate of ANIM_FRAME_LADDER) {
    if (candidate < current) out.push(candidate);
  }
  return out;
}

/** 给定帧数下可用的帧尺寸候选（从大到小，且 side×frames ≤ ANIM_SPRITE_MAX_WIDTH）。 */
function frameSideCandidates(frames) {
  const count = Math.floor(Number(frames) || 0);
  if (!(count > 0)) return [];
  return ANIM_FRAME_SIDES.filter(function (side) {
    return side * count <= ANIM_SPRITE_MAX_WIDTH;
  });
}

/** 雪碧图尺寸：横向 frames × side，纵向 side。 */
function spriteSheetSize(frames, side) {
  const count = Math.floor(Number(frames) || 0);
  const size = Math.floor(Number(side) || 0);
  if (!(count > 0) || !(size > 0)) return null;
  return { width: count * size, height: size };
}

function animationPlaybackMs(frames, frameMs) {
  const count = Math.floor(Number(frames) || 0);
  const ms = Math.floor(Number(frameMs) || 0);
  if (!(count > 0) || !(ms > 0)) return 0;
  return count * ms;
}

/** 距上次让出累计耗时达到预算才让出；预算非法时退化为每次让出（保守）。 */
function animationShouldYieldToMain(elapsedMs, budgetMs) {
  const elapsed = Number(elapsedMs);
  const budget = Number(budgetMs);
  if (!(budget > 0) || !isFinite(budget)) return true;
  return isFinite(elapsed) && elapsed >= budget;
}

/** 该帧数档下要同时绘制的候选画布计划（side 降序，含雪碧图宽高；内存峰值 = 各画布像素之和）。 */
function planBakeCanvases(frames, sides) {
  const out = [];
  for (const side of sides || []) {
    const size = spriteSheetSize(frames, side);
    if (!size) continue;
    out.push({ side: Math.floor(Number(side) || 0), width: size.width, height: size.height });
  }
  return out;
}

/** 大画布候选先用最低质量编码探底（只影响编码顺序，不改变最终选择）。 */
function animationEncodeFloorFirst(canvasPixels) {
  const pixels = Number(canvasPixels);
  return isFinite(pixels) && pixels >= ANIM_FLOOR_FIRST_PIXELS;
}
// @chat-avatars-animation:end

/** 让出事件循环，避免 256×N 绘制/编码形成 >50ms 长任务。 */
function yieldToMain() {
  return new Promise(function (resolve) {
    try {
      setTimeout(resolve, 0);
    } catch (error) {
      resolve();
    }
  });
}

/** 单调时间毫秒（performance.now 优先）；仅用于让出预算，不参与输出。 */
function animationNowMs() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (error) {}
  return Date.now();
}

/** 解出首帧的可绘制预览（优先 ImageBitmap，失败回退 canvas 快照）。 */
function createFramePreview(frame) {
  return Promise.resolve()
    .then(function () {
      if (typeof createImageBitmap !== 'function') return null;
      return createImageBitmap(frame);
    })
    .catch(function () {
      return null;
    })
    .then(function (bitmap) {
      if (bitmap) return bitmap;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = frame.displayWidth || frame.codedWidth || 0;
        canvas.height = frame.displayHeight || frame.codedHeight || 0;
        if (!(canvas.width > 0) || !(canvas.height > 0)) return null;
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(frame, 0, 0);
        return canvas;
      } catch (error) {
        return null;
      }
    });
}

/**
 * 第一轮解码：顺序解出全部帧的时长、尺寸与首帧预览；不做绘制。
 * 返回 { animated, frameCount, durations, width, height, preview }。
 */
function decodeAnimationInfo(buffer, format) {
  const mime = IMAGE_MIME_BY_FORMAT[format];
  if (!mime) return Promise.reject(makeError('E_DECODE'));
  return Promise.resolve().then(function () {
    if (typeof ImageDecoder !== 'function') throw makeError(ERROR_CODES.ANIM_UNSUPPORTED);
    let decoder = null;
    let preview = null;
    return Promise.resolve()
      .then(function () {
        decoder = new ImageDecoder({ data: buffer.slice(0), type: mime, preferAnimation: true });
        return decoder.tracks.ready;
      })
      .then(function () {
        const track = decoder.tracks.selectedTrack;
        const frameCount = track ? Number(track.frameCount) || 0 : 0;
        if (frameCount < 1) throw makeError('E_DECODE');
        const durations = [];
        let width = 0;
        let height = 0;
        const loop = function (index) {
          if (index >= frameCount) {
            return { animated: frameCount >= 2, frameCount: frameCount, durations: durations, width: width, height: height, preview: preview };
          }
          return decoder.decode({ frameIndex: index }).then(function (result) {
            const frame = result && result.image;
            if (!frame) throw makeError('E_DECODE');
            const duration = Number(frame.duration);
            durations.push(isFinite(duration) && duration > 0 ? duration : null);
            const finishFrame = function () {
              try {
                frame.close();
              } catch (error) {}
              return loop(index + 1);
            };
            if (index === 0) {
              width = frame.displayWidth || frame.codedWidth || 0;
              height = frame.displayHeight || frame.codedHeight || 0;
              return createFramePreview(frame).then(function (bitmap) {
                preview = bitmap;
                return finishFrame();
              });
            }
            return finishFrame();
          });
        };
        return loop(0);
      })
      .then(
        function (info) {
          try {
            if (decoder) decoder.close();
          } catch (error) {}
          return info;
        },
        function (error) {
          try {
            if (decoder) decoder.close();
          } catch (ignored) {}
          // 中途失败时首帧预览已创建但不会返回给调用方，必须在这里释放，避免 ImageBitmap 泄漏。
          if (preview && typeof preview.close === 'function') {
            try {
              preview.close();
            } catch (ignored) {}
          }
          preview = null;
          if (error && error.code) throw error;
          throw makeError('E_DECODE');
        }
      );
  });
}

function closePreparedSource(source) {
  closeDecodedSource(source);
}

/** 读取文件字节并校验大小/类型/动画能力；静态返回 source，动图返回 job（含首轮解码计划）。 */
function prepareAvatarFile(file) {
  return Promise.resolve()
    .then(function () {
      if (!file || typeof file.arrayBuffer !== 'function') throw makeError('E_TYPE');
      const size = typeof file.size === 'number' ? file.size : 0;
      if (size > ANIM_INPUT_BYTES) throw makeError('E_SIZE');
      return file.arrayBuffer().then(function (buffer) {
        const bytes = new Uint8Array(buffer);
        const format = detectImageFormat(bytes) || formatFromMime(file.type);
        if (!format) throw makeError('E_TYPE');
        const animated =
          format === 'gif'
            ? true
            : format === 'png'
              ? isAnimatedPng(bytes)
              : format === 'webp'
                ? isAnimatedWebp(bytes)
                : false;
        if (!animated) {
          if (size > IMAGE_LIMITS.staticInputBytes) throw makeError('E_SIZE');
          const blob = new Blob([buffer], { type: IMAGE_MIME_BY_FORMAT[format] });
          return decodeBlob(blob).then(function (source) {
            const dimensions = decodedSourceSize(source);
            const dimensionError = imageDimensionsError(dimensions.width, dimensions.height);
            if (dimensionError) {
              closePreparedSource(source);
              throw makeError(dimensionError);
            }
            return { kind: 'static', source: source, width: dimensions.width, height: dimensions.height };
          });
        }
        if (typeof ImageDecoder !== 'function') throw makeError(ERROR_CODES.ANIM_UNSUPPORTED);
        return decodeAnimationInfo(buffer, format).then(function (info) {
          const dimensionError = imageDimensionsError(info.width, info.height);
          if (dimensionError) {
            closePreparedSource(info.preview);
            throw makeError(dimensionError);
          }
          if (!info.animated) {
            if (!info.preview) throw makeError('E_DECODE');
            return { kind: 'static', source: info.preview, width: info.width, height: info.height };
          }
          const plan = planAnimationFrames(info.durations);
          if (!plan) {
            closePreparedSource(info.preview);
            throw makeError('E_DECODE');
          }
          if (!info.preview) {
            closePreparedSource(info.preview);
            throw makeError('E_DECODE');
          }
          return {
            kind: 'animated',
            source: info.preview,
            width: info.width,
            height: info.height,
            plan: plan,
            job: {
              buffer: buffer,
              format: format,
              mime: IMAGE_MIME_BY_FORMAT[format],
              width: info.width,
              height: info.height,
              durationsUs: normalizeFrameDurations(info.durations, info.frameCount),
              plan: plan
            }
          };
        });
      });
    })
    .catch(function (error) {
      if (error && error.code) throw error;
      throw makeError('E_DECODE');
    });
}

/**
 * 第二轮解码 + 逐帧裁剪 + 横向拼图 + WebP 质量阶梯。
 * A（2026-10-21）：
 * 1) 一次解码同时把每个采样帧绘制到该帧数档的**全部候选帧尺寸**，不再为每个尺寸重复全量解码；
 * 2) 最小候选帧尺寸作为延迟档，仅当其余候选全部超限时才绘制/编码（常态少画一张画布）；
 * 3) 大画布候选（像素数 ≥ ANIM_FLOOR_FIRST_PIXELS）先用最低质量探底，整档超限时省一次高质量编码。
 * 输出选择语义不变：尺寸从大到小、同一尺寸内取能放进上限的最高质量。
 * 返回 { kind:'animated', v:1, src, frames, frameMs } 或 null（全部候选超限/编码失败，交由上层降帧）。
 * 代价：候选画布同时驻留（本机最坏约 +20MB，一次性、编码后随作用域释放）。
 */
function bakeAnimationCandidates(job, cropRect, frames, sides) {
  return Promise.resolve().then(function () {
    const plan = planSamplePlan(job.durationsUs, frames);
    if (!plan) return null;
    const canvasPlans = planBakeCanvases(plan.frames, sides);
    if (!canvasPlans.length) return null;
    const eagerPlans = canvasPlans.length > 1 ? canvasPlans.slice(0, -1) : canvasPlans;
    const deferredPlan = canvasPlans.length > 1 ? canvasPlans[canvasPlans.length - 1] : null;
    const indices = plan.frameIndices;
    const buildValue = function (dataUrl) {
      const value = { kind: 'animated', v: 1, src: dataUrl, frames: plan.frames, frameMs: plan.frameMs };
      return validAvatar(value) ? value : null;
    };
    const encodeAt = function (canvas, quality) {
      return canvasToBlob(canvas, 'image/webp', quality)
        .then(function (blob) {
          if (!blob || blob.type !== 'image/webp') return null;
          return blobToDataUrl(blob).catch(function () {
            return null;
          });
        })
        .then(buildValue);
    };
    // 质量阶梯：默认「最高 → 最低探底 → 中间」；大画布反过来先探底。
    const encodeLadder = function (canvas, floorFirst) {
      const bestQuality = ANIM_QUALITY_LADDER[0];
      const floorQuality = ANIM_QUALITY_LADDER[ANIM_QUALITY_LADDER.length - 1];
      const middleQualities = ANIM_QUALITY_LADDER.slice(1, -1);
      const finishFromFloor = function (floorValue) {
        const tryMiddle = function (middleIndex) {
          if (middleIndex >= middleQualities.length) return Promise.resolve(floorValue);
          return encodeAt(canvas, middleQualities[middleIndex]).then(function (value) {
            return value || tryMiddle(middleIndex + 1);
          });
        };
        return tryMiddle(0);
      };
      if (floorFirst) {
        return encodeAt(canvas, floorQuality).then(function (floorValue) {
          if (!floorValue) return null;
          return encodeAt(canvas, bestQuality).then(function (bestValue) {
            return bestValue || finishFromFloor(floorValue);
          });
        });
      }
      return encodeAt(canvas, bestQuality).then(function (bestValue) {
        if (bestValue) return bestValue;
        return encodeAt(canvas, floorQuality).then(function (floorValue) {
          return floorValue ? finishFromFloor(floorValue) : null;
        });
      });
    };
    const encodeCandidates = function (canvases, candidateIndex) {
      if (candidateIndex >= canvases.length) return Promise.resolve(null);
      const candidate = canvases[candidateIndex];
      const pixels = candidate.canvas.width * candidate.canvas.height;
      return encodeLadder(candidate.canvas, animationEncodeFloorFirst(pixels)).then(function (value) {
        if (value) return value;
        try {
          candidate.canvas.width = 0;
          candidate.canvas.height = 0;
        } catch (error) {}
        return encodeCandidates(canvases, candidateIndex + 1);
      });
    };
    const releaseCanvases = function (canvases) {
      for (const candidate of canvases) {
        try {
          candidate.canvas.width = 0;
          candidate.canvas.height = 0;
        } catch (error) {}
      }
    };
    const decodePass = function (plans) {
      const canvases = plans.map(function (entry) {
        const canvas = document.createElement('canvas');
        canvas.width = entry.width;
        canvas.height = entry.height;
        return { side: entry.side, canvas: canvas };
      });
      if (!canvases.length) return Promise.resolve({ canvases: canvases, complete: false });
      let slot = 0;
      let decoder = null;
      let lastYieldAt = animationNowMs();
      const drawSelected = function (frame, index) {
        let drew = false;
        while (slot < indices.length && indices[slot] <= index) {
          for (let candidateIndex = 0; candidateIndex < canvases.length; candidateIndex += 1) {
            const candidate = canvases[candidateIndex];
            drawImageCropInto(candidate.canvas, frame, cropRect, candidate.side, slot * candidate.side, 0);
          }
          slot += 1;
          drew = true;
        }
        if (!drew) return Promise.resolve();
        const now = animationNowMs();
        if (slot >= indices.length || animationShouldYieldToMain(now - lastYieldAt, ANIM_YIELD_BUDGET_MS)) {
          lastYieldAt = now;
          return yieldToMain();
        }
        return Promise.resolve();
      };
      const decodeLoop = function (index) {
        if (index >= plan.sourceFrames) return Promise.resolve();
        return decoder.decode({ frameIndex: index }).then(function (result) {
          const frame = result && result.image;
          if (!frame) throw makeError('E_DECODE');
          return drawSelected(frame, index)
            .then(function () {
              return undefined;
            })
            .then(
              function () {
                try {
                  frame.close();
                } catch (error) {}
                return decodeLoop(index + 1);
              },
              function (error) {
                try {
                  frame.close();
                } catch (ignored) {}
                throw error;
              }
            );
        });
      };
      return Promise.resolve()
        .then(function () {
          decoder = new ImageDecoder({ data: job.buffer.slice(0), type: job.mime, preferAnimation: true });
          return decoder.tracks.ready;
        })
        .then(function () {
          return decodeLoop(0);
        })
        .then(
          function () {
            try {
              if (decoder) decoder.close();
            } catch (error) {}
            return { canvases: canvases, complete: slot === indices.length };
          },
          function (error) {
            try {
              if (decoder) decoder.close();
            } catch (ignored) {}
            releaseCanvases(canvases);
            if (error && error.code) throw error;
            throw makeError('E_DECODE');
          }
        );
    };
    const releaseThen = function (promise, canvases) {
      return promise.then(
        function (value) {
          releaseCanvases(canvases);
          return value;
        },
        function (error) {
          releaseCanvases(canvases);
          throw error;
        }
      );
    };
    return decodePass(eagerPlans).then(function (pass) {
      if (!pass.complete) {
        releaseCanvases(pass.canvases);
        return null;
      }
      return releaseThen(encodeCandidates(pass.canvases, 0), pass.canvases).then(function (value) {
        if (value) return value;
        if (!deferredPlan) return null;
        return decodePass([deferredPlan]).then(function (deferredPass) {
          if (!deferredPass.complete) {
            releaseCanvases(deferredPass.canvases);
            return null;
          }
          return releaseThen(encodeCandidates(deferredPass.canvases, 0), deferredPass.canvases);
        });
      });
    });
  });
}

/**
 * 雪碧图烘焙：按自适应帧数一次解码绘制该档全部候选帧尺寸（A 优化），
 * 编码从大到小择优；仍超则按帧数阶梯降级重采样（重新解码）；全部失败 E_TOO_LARGE。
 */
function bakeAnimationSprite(job, cropRect) {
  return Promise.resolve()
    .then(function () {
      if (!job || !job.durationsUs) throw makeError('E_DECODE');
      const initial = job.plan || planAnimationFrames(job.durationsUs);
      if (!initial) throw makeError('E_DECODE');
      const frameCounts = [initial.frames].concat(planDegradeFrames(initial.frames));
      let frameIndex = 0;
      const tryFrameCount = function () {
        if (frameIndex >= frameCounts.length) return Promise.reject(makeError('E_TOO_LARGE'));
        const frames = frameCounts[frameIndex];
        frameIndex += 1;
        const sides = frameSideCandidates(frames);
        if (!sides.length) return tryFrameCount();
        return bakeAnimationCandidates(job, cropRect, frames, sides).then(function (value) {
          return value || tryFrameCount();
        });
      };
      return tryFrameCount();
    })
    .catch(function (error) {
      if (error && error.code) throw error;
      throw makeError('E_ENCODE');
    });
}
