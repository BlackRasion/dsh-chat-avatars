/**
 * @module 55-crop
 * 职责：交互式裁剪对话框——拖拽/缩放/实时预览；几何纯函数与 React 组件；最终交给 50-image/51-animation
 *       输出固定 256px（M5 起；动图预览首帧、确认后逐帧烘焙）。
 * 依赖：image（drawImageCrop/processImageSource）/ i18n / status（warnWithCode）。
 * 被依赖：settings（M2 上传入口）；M3 会话内点击入口复用同一组件。
 * 状态：M2 已实现（原生 <dialog> top-layer；不做 portal、不写 document.body；桌面 Web GUI）。
 */

const CROP_LIMITS = Object.freeze({
  minZoom: 1,
  maxZoom: 4,
  wheelFactor: 1.1,
  buttonStep: 0.25,
  keyboardStep: 0.05
});

// @chat-avatars-crop:start
/** 数值 clamp；非数字回落到 min（保证几何函数永不产出 NaN）。 */
function clampCropValue(value, min, max) {
  const number = Number(value);
  if (!isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

/** 创建初始裁剪视图（cover 居中，zoom=1）；非法尺寸返回 null。 */
function createCropView(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  return { zoom: 1, offsetX: 0, offsetY: 0 };
}

/** 归一化视图：zoom 限 [1,4]，归一化偏移限 [-1,1]；缺省/非法值回落到 1 与 0。 */
function clampCropView(view, width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const zoom = view && isFinite(Number(view.zoom)) ? Number(view.zoom) : CROP_LIMITS.minZoom;
  const offsetX = view && isFinite(Number(view.offsetX)) ? Number(view.offsetX) : 0;
  const offsetY = view && isFinite(Number(view.offsetY)) ? Number(view.offsetY) : 0;
  return {
    zoom: clampCropValue(zoom, CROP_LIMITS.minZoom, CROP_LIMITS.maxZoom),
    offsetX: clampCropValue(offsetX, -1, 1),
    offsetY: clampCropValue(offsetY, -1, 1)
  };
}

/** 视图 -> 源图裁剪矩形 {sx, sy, side}；side = min(w,h)/zoom，偏移 0 居中、±1 贴边。 */
function cropSourceRect(view, width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const safe = clampCropView(view, width, height);
  const side = Math.min(width, height) / safe.zoom;
  const maxX = Math.max(0, (width - side) / 2);
  const maxY = Math.max(0, (height - side) / 2);
  const sx = (width - side) / 2 + safe.offsetX * maxX;
  const sy = (height - side) / 2 + safe.offsetY * maxY;
  return {
    sx: Math.max(0, Math.min(sx, width - side)),
    sy: Math.max(0, Math.min(sy, height - side)),
    side: side
  };
}

/** 归一化偏移平移（拖拽/键盘共用）；结果始终 clamp。 */
function panCropView(view, deltaX, deltaY, width, height) {
  const safe = clampCropView(view, width, height);
  if (!safe) return null;
  return clampCropView(
    { zoom: safe.zoom, offsetX: safe.offsetX + deltaX, offsetY: safe.offsetY + deltaY },
    width,
    height
  );
}

/** 视口像素位移 -> 归一化偏移；把「图片跟手」换算成裁剪窗口反向移动。 */
function panCropViewByPixels(view, dxPixels, dyPixels, width, height, viewportSize) {
  const safe = clampCropView(view, width, height);
  if (!safe || !(viewportSize > 0)) return safe;
  const side = Math.min(width, height) / safe.zoom;
  const pixelsPerSource = viewportSize / side;
  const maxX = Math.max(0, (width - side) / 2);
  const maxY = Math.max(0, (height - side) / 2);
  const deltaX = maxX > 0 ? -(dxPixels / pixelsPerSource) / maxX : 0;
  const deltaY = maxY > 0 ? -(dyPixels / pixelsPerSource) / maxY : 0;
  return panCropView(safe, deltaX, deltaY, width, height);
}

/** 缩放（滚轮/滑块/按钮共用）；偏移保持归一化值，越界由 clamp 处理。 */
function zoomCropView(view, nextZoom, width, height) {
  const safe = clampCropView(view, width, height);
  if (!safe) return null;
  return clampCropView({ zoom: nextZoom, offsetX: safe.offsetX, offsetY: safe.offsetY }, width, height);
}

/** 方向键平移（步长 keyboardStep）；非方向键原样返回。 */
function keyboardPanCropView(view, key, width, height) {
  const step = CROP_LIMITS.keyboardStep;
  if (key === 'ArrowLeft') return panCropView(view, -step, 0, width, height);
  if (key === 'ArrowRight') return panCropView(view, step, 0, width, height);
  if (key === 'ArrowUp') return panCropView(view, 0, -step, width, height);
  if (key === 'ArrowDown') return panCropView(view, 0, step, width, height);
  return clampCropView(view, width, height);
}
// @chat-avatars-crop:end

/**
 * 裁剪对话框：原生 <dialog> + showModal()（top-layer），挂载即打开，关闭时把焦点还给触发按钮。
 * props：request={ id, source, width, height }、shape='circle'|'rounded'、onCancel、onApply(rect)。
 */
function CropDialog(props) {
  const request = props.request;
  const width = request.width;
  const height = request.height;
  const dialogRef = React.useRef(null);
  const stageRef = React.useRef(null);
  const stageCanvasRef = React.useRef(null);
  const previewCanvasRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const state = React.useState(function () {
    return createCropView(width, height) || { zoom: 1, offsetX: 0, offsetY: 0 };
  });
  const view = state[0];
  const setView = state[1];
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const shape = props.shape === 'rounded' ? 'rounded' : 'circle';
  const closedRef = React.useRef(false);

  const finish = React.useCallback(
    function (apply) {
      if (closedRef.current) return;
      closedRef.current = true;
      try {
        if (apply) {
          const rect = cropSourceRect(viewRef.current, width, height);
          props.onApply(rect);
        } else {
          props.onCancel();
        }
      } catch (error) {
        warnWithCode('E_CROP', error);
        try {
          props.onCancel();
        } catch (ignored) {}
      }
    },
    [props, width, height]
  );

  // 打开/关闭：原生 dialog top-layer + 焦点归还。
  React.useLayoutEffect(function () {
    const dialog = dialogRef.current;
    let previous = null;
    try {
      previous = typeof document === 'undefined' ? null : document.activeElement;
    } catch (error) {}
    try {
      if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      else if (dialog && typeof dialog.setAttribute === 'function') dialog.setAttribute('open', '');
    } catch (error) {
      warnWithCode('E_CROP', error);
    }
    try {
      if (stageRef.current && typeof stageRef.current.focus === 'function') stageRef.current.focus();
    } catch (error) {}
    return function () {
      try {
        if (dialog && typeof dialog.close === 'function' && dialog.open) dialog.close();
      } catch (error) {}
      try {
        if (previous && typeof previous.focus === 'function') previous.focus();
      } catch (error) {}
    };
  }, []);

  // 实时绘制：舞台与预览共用 drawImageCrop/rect，保证「预览 = 最终头像」。
  React.useEffect(
    function () {
      try {
        const rect = cropSourceRect(view, width, height);
        if (!rect) return;
        if (stageCanvasRef.current) drawImageCrop(stageCanvasRef.current, request.source, rect, 320);
        if (previewCanvasRef.current) drawImageCrop(previewCanvasRef.current, request.source, rect, 128);
      } catch (error) {
        warnWithCode('E_CROP', error);
      }
    },
    [view, request.source, width, height]
  );

  // 滚轮缩放：原生非 passive 监听才能 preventDefault（React onWheel 是 passive）。
  React.useEffect(
    function () {
      const stage = stageRef.current;
      if (!stage || typeof stage.addEventListener !== 'function') return;
      const onWheel = function (event) {
        try {
          event.preventDefault();
          const factor = event.deltaY < 0 ? CROP_LIMITS.wheelFactor : 1 / CROP_LIMITS.wheelFactor;
          setView(function (current) {
            return zoomCropView(current, current.zoom * factor, width, height) || current;
          });
        } catch (error) {
          warnWithCode('E_CROP', error);
        }
      };
      stage.addEventListener('wheel', onWheel, { passive: false });
      return function () {
        try {
          stage.removeEventListener('wheel', onWheel, { passive: false });
        } catch (error) {}
      };
    },
    [width, height, setView]
  );

  const onPointerDown = function (event) {
    try {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startView: viewRef.current,
        viewportSize: rect.width || rect.height || 0
      };
      if (typeof stage.setPointerCapture === 'function') stage.setPointerCapture(event.pointerId);
      if (typeof event.preventDefault === 'function') event.preventDefault();
    } catch (error) {
      warnWithCode('E_CROP', error);
    }
  };

  const onPointerMove = function (event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      const next = panCropViewByPixels(
        drag.startView,
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        width,
        height,
        drag.viewportSize
      );
      if (next) setView(next);
    } catch (error) {
      warnWithCode('E_CROP', error);
    }
  };

  const endDrag = function (event) {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      const stage = stageRef.current;
      if (drag && stage && typeof stage.releasePointerCapture === 'function') stage.releasePointerCapture(drag.pointerId);
    } catch (error) {}
    if (event && typeof event.preventDefault === 'function') {
      try {
        event.preventDefault();
      } catch (error) {}
    }
  };

  const onKeyDown = function (event) {
    const key = event && event.key;
    const targetTag = event && event.target && event.target.tagName ? String(event.target.tagName).toUpperCase() : '';
    try {
      if (key === 'Enter' && targetTag !== 'BUTTON' && targetTag !== 'INPUT') {
        event.preventDefault();
        finish(true);
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (targetTag === 'INPUT' || targetTag === 'SELECT' || targetTag === 'TEXTAREA' || targetTag === 'BUTTON') return;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        setView(function (current) {
          return keyboardPanCropView(current, key, width, height) || current;
        });
      }
    } catch (error) {
      warnWithCode('E_CROP', error);
    }
  };

  const zoomBy = function (delta) {
    setView(function (current) {
      return zoomCropView(current, current.zoom + delta, width, height) || current;
    });
  };
  const resetView = function () {
    const initial = createCropView(width, height);
    if (initial) setView(initial);
  };

  return h(
    'dialog',
    {
      ref: dialogRef,
      className: 'dsh-av-crop-dialog',
      'aria-label': t('crop.title'),
      onCancel: function (event) {
        try {
          event.preventDefault();
        } catch (error) {}
        finish(false);
      },
      onKeyDown: onKeyDown
    },
    h('div', { className: 'dsh-av-crop-head' }, t('crop.title')),
    props.scopeHint ? h('div', { className: 'dsh-av-crop-scope' }, props.scopeHint) : null,
    request.kind === 'animated' ? h('div', { className: 'dsh-av-crop-scope' }, t('crop.animatedHint')) : null,
    h(
      'div',
      { className: 'dsh-av-crop-body' },
      h(
        'div',
        {
          ref: stageRef,
          className: 'dsh-av-crop-stage',
          tabIndex: 0,
          role: 'img',
          'aria-label': t('crop.stage'),
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag
        },
        h('canvas', { ref: stageCanvasRef, className: 'dsh-av-crop-canvas', width: 320, height: 320 })
      ),
      h(
        'div',
        { className: 'dsh-av-crop-side' },
        h('div', { className: 'dsh-av-crop-preview-label' }, t('crop.preview')),
        h('canvas', {
          ref: previewCanvasRef,
          className: 'dsh-av-crop-preview' + (shape === 'rounded' ? ' is-rounded' : ''),
          width: 128,
          height: 128
        }),
        h('div', { className: 'dsh-av-crop-hint' }, t('crop.hint'))
      )
    ),
    h(
      'label',
      { className: 'dsh-av-crop-zoom' },
      h('span', null, t('crop.zoom')),
      h('input', {
        type: 'range',
        min: CROP_LIMITS.minZoom,
        max: CROP_LIMITS.maxZoom,
        step: 0.01,
        value: view.zoom,
        'aria-label': t('crop.zoom'),
        onChange: function (event) {
          const next = Number(event.target.value);
          setView(function (current) {
            return zoomCropView(current, next, width, height) || current;
          });
        }
      })
    ),
    h(
      'div',
      { className: 'dsh-av-crop-actions' },
      h(
        'button',
        { type: 'button', className: 'dsh-av-btn', 'aria-label': t('crop.zoomOut'), onClick: function () { zoomBy(-CROP_LIMITS.buttonStep); } },
        '−'
      ),
      h(
        'button',
        { type: 'button', className: 'dsh-av-btn', 'aria-label': t('crop.zoomIn'), onClick: function () { zoomBy(CROP_LIMITS.buttonStep); } },
        '+'
      ),
      h('button', { type: 'button', className: 'dsh-av-btn', onClick: resetView }, t('crop.reset')),
      h('span', { className: 'dsh-av-crop-spacer' }),
      h('button', { type: 'button', className: 'dsh-av-btn', onClick: function () { finish(false); } }, t('crop.cancel')),
      h(
        'button',
        { type: 'button', className: 'dsh-av-btn dsh-av-btn-primary', onClick: function () { finish(true); } },
        t('crop.apply')
      )
    )
  );
}
