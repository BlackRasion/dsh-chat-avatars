/**
 * @module 65-interaction
 * 职责：会话内点击头像——几何命中（只认头像区域）、hover 描边、file input + M2 裁剪对话框、按 scope 写库。
 * 依赖：contract / store / image / crop / i18n / status（warnWithCode）。
 * 被依赖：bridge（在会话内渲染 AvatarInteraction 隐藏组件，不新增 slot 注册）。
 * 状态：M3 已实现；点击只改当前工作区覆盖（无工作区时改全局），与设置页走同一 store.setAvatar 路径。
 */

const HOVER_ATTR = 'data-dsh-av-hover';
const HIT_TOP_OFFSET = 2;

// @chat-avatars-interaction:start
/** 行 kind -> 头像侧；非消息行返回 null。 */
function avatarSideForKind(kind) {
  if (kind === CONTRACT.kinds.user || kind === CONTRACT.kinds.steering) return 'user';
  if (kind === CONTRACT.kinds.assistant) return 'assistant';
  return null;
}

/** 解析 CSS 像素值；非法/非正返回 0。 */
function parseCssPixels(value) {
  const number = parseFloat(String(value === undefined || value === null ? '' : value));
  return isFinite(number) && number > 0 ? number : 0;
}

/**
 * 行矩形 + 伪元素计算样式 -> 头像命中矩形（正方形）。
 * display:none（含 520 容器查询隐藏）或尺寸为 0 返回 null。
 */
function computeAvatarHitRect(rowRect, pseudoStyle, side) {
  if (!rowRect || !pseudoStyle) return null;
  if (side !== 'user' && side !== 'assistant') return null;
  if (String(pseudoStyle.display) === 'none') return null;
  const size = Math.max(parseCssPixels(pseudoStyle.width), parseCssPixels(pseudoStyle.height));
  if (!(size > 0)) return null;
  return {
    side: side,
    x: side === 'user' ? rowRect.right - size : rowRect.left,
    y: rowRect.top + HIT_TOP_OFFSET,
    width: size,
    height: size
  };
}

/** 点是否落在命中矩形内（含边界）。 */
function hitTestAvatar(x, y, rect) {
  if (!rect) return false;
  if (!isFinite(x) || !isFinite(y)) return false;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** scope 归一化：工作区已知 -> { workspaceId }（覆盖）；否则 global。 */
function resolveAvatarScope(workspaceId) {
  if (workspaceId === null || workspaceId === undefined || workspaceId === '') return 'global';
  return { workspaceId: workspaceId };
}
// @chat-avatars-interaction:end

function findInteractionRoots(sessionId, attr) {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') return [];
    if (sessionId === null || sessionId === undefined) return [];
    const nodes = document.querySelectorAll('[' + attr + ']');
    if (!nodes || typeof nodes.length !== 'number') return [];
    const key = String(sessionId);
    const roots = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node && node.dataset && String(node.dataset.conversationSession) === key) roots.push(node);
    }
    return roots;
  } catch (error) {
    return [];
  }
}

function pseudoElementOf(side) {
  return side === 'user' ? '::after' : '::before';
}

/**
 * 会话内交互层：隐藏 file input + hover 命中 + 打开 M2 裁剪对话框。
 * props：sessionId / workspaceId / snapshot（store 快照）/ conversationSnapshot（驱动监听重绑）。
 */
function AvatarInteraction(props) {
  const snapshot = props.snapshot || null;
  const sessionId = props.sessionId;
  const workspaceId = props.workspaceId;
  const conversationSnapshot = props.conversationSnapshot;
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const workspaceIdRef = React.useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const pendingRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const requestState = React.useState(null);
  const request = requestState[0];
  const setRequest = requestState[1];
  const requestRef = React.useRef(null);
  requestRef.current = request;
  const hoveredRef = React.useRef(new Set());
  // M7 打磨：记录最近一次指针坐标，用于 selectstart/双击时判断是否从头像区域开始选择。
  const lastPointerRef = React.useRef(null);
  const requestIdRef = React.useRef(0);
  // 卸载竞态：异步 prepare/bake 完成时若组件已卸载，释放 source 且不写 store/setState。
  const aliveRef = React.useRef(true);
  // M7：单击/双击消歧、预览与拍一拍状态；全部经 ref 供事件闭包读取，避免过期闭包。
  const clickStateRef = React.useRef(null);
  const previewTimerRef = React.useRef(0);
  const previewIdRef = React.useRef(0);
  const previewState = React.useState(null);
  const preview = previewState[0];
  const setPreview = previewState[1];
  const previewRef = React.useRef(null);
  previewRef.current = preview;
  const pokeState = React.useState(null);
  const poke = pokeState[0];
  const setPoke = pokeState[1];
  const pokeIdRef = React.useRef(0);
  const lastPokeAtRef = React.useRef(0);
  const active = !!(
    snapshot &&
    snapshot.data &&
    snapshot.data.settings &&
    snapshot.data.settings.enabled &&
    !snapshot.paused
  );
  const shape = snapshot && snapshot.data && snapshot.data.settings ? snapshot.data.settings.shape : 'circle';

  const clearHover = React.useCallback(function () {
    // 不能替换 Set：事件处理器持有同一个 Set 引用，替换会让后续 clear 清不到旧元素。
    for (const row of hoveredRef.current) {
      try {
        row.removeAttribute(HOVER_ATTR);
      } catch (error) {}
    }
    hoveredRef.current.clear();
  }, []);

  // M7 打磨：清空浏览器文本选区——双击头像不应选中周边文本（视觉上像按钮而非可选文字）。
  const clearTextSelection = React.useCallback(function () {
    try {
      if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return;
      const selection = window.getSelection();
      if (selection && typeof selection.removeAllRanges === 'function' && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    } catch (error) {}
  }, []);

  const closeRequest = React.useCallback(function () {
    const current = requestRef.current;
    requestRef.current = null;
    try {
      if (current && current.source && typeof current.source.close === 'function') current.source.close();
    } catch (error) {}
    setRequest(null);
  }, []);

  const handleApply = React.useCallback(function (rect) {
    const current = requestRef.current;
    if (!current) return;
    const animated = current.kind === 'animated';
    Promise.resolve()
      .then(function () {
        return animated ? bakeAnimationSprite(current.job, rect) : processImageSource(current.source, rect);
      })
      .then(function (value) {
        if (!aliveRef.current) {
          try {
            if (current && current.source && typeof current.source.close === 'function') current.source.close();
          } catch (error) {}
          return;
        }
        const result = setStoreAvatar(current.scope, current.side, value);
        if (result && result.ok === false) warnWithCode(result.code || 'E_STORE');
      })
      .catch(function (error) {
        warnWithCode(codeOf(error), error);
      })
      .then(function () {
        closeRequest();
      });
  }, [closeRequest]);

  // M7：预览/拍一拍辅助（事件闭包只读 ref，不依赖渲染期 props）。
  const clearPreviewTimer = function () {
    if (previewTimerRef.current) {
      try {
        clearTimeout(previewTimerRef.current);
      } catch (error) {}
      previewTimerRef.current = 0;
    }
  };

  const closePreview = function () {
    setPreview(null);
  };

  const playPokeFor = function (side) {
    try {
      const state = snapshotRef.current;
      if (!state || !state.data || !state.data.settings) return;
      const pokeSettings = state.data.settings.poke;
      if (!pokeSettings || pokeSettings.sound === false) return;
      playPokeSound(resolvePokeVolume(pokeSettings));
    } catch (error) {
      warnWithCode('E_POKE', error);
    }
  };

  const openPreviewFor = function (pendingPreview) {
    try {
      if (!pendingPreview) return;
      const state = snapshotRef.current;
      if (!state || state.paused || !state.data || !state.data.settings || !state.data.settings.enabled) return;
      const info = resolvePreviewInfo(state.data, workspaceIdRef.current, pendingPreview.side, {
        user: t('default.user'),
        assistant: t('default.assistant')
      });
      if (!info) return;
      previewIdRef.current += 1;
      setPreview({
        id: previewIdRef.current,
        side: pendingPreview.side,
        info: info,
        pokeText: resolvePokeText(state.data.settings.poke, pendingPreview.side, {
          user: t('poke.defaultUser'),
          assistant: t('poke.defaultAssistant')
        })
      });
    } catch (error) {
      warnWithCode('E_PREVIEW', error);
    }
  };

  const handleReplaceAvatar = function () {
    const current = previewRef.current;
    closePreview();
    if (!current) return;
    pendingRef.current = { scope: resolveAvatarScope(workspaceIdRef.current), side: current.side };
    const input = inputRef.current;
    if (input && typeof input.click === 'function') input.click();
  };

  const triggerPoke = function (hit) {
    try {
      const state = snapshotRef.current;
      if (!state || state.paused || !state.data || !state.data.settings || !state.data.settings.enabled) return;
      const pokeSettings = state.data.settings.poke;
      if (!pokeSettings || pokeSettings.enabled === false) return;
      const now = Date.now();
      if (pokeCoolingDown(lastPokeAtRef.current, now)) return;
      lastPokeAtRef.current = now;
      clearTextSelection();
      clearPreviewTimer();
      const row = hit.row;
      const rowRect = row.getBoundingClientRect();
      const pseudo = getComputedStyle(row, pseudoElementOf(hit.side));
      const anchor =
        computeAvatarHitRect(
          rowRect,
          { display: pseudo.display, width: pseudo.width, height: pseudo.height },
          hit.side
        ) || { x: rowRect.left, y: rowRect.top, width: Math.max(1, rowRect.height), height: Math.max(1, rowRect.height) };
      pokeIdRef.current += 1;
      setPoke({
        id: pokeIdRef.current,
        side: hit.side,
        text: resolvePokeText(pokeSettings, hit.side, {
          user: t('poke.defaultUser'),
          assistant: t('poke.defaultAssistant')
        }),
        anchor: anchor,
        row: row
      });
      if (pokeSettings.sound !== false) playPokeSound(resolvePokeVolume(pokeSettings));
    } catch (error) {
      warnWithCode('E_POKE', error);
    }
  };

  const handleFile = function (event) {
    const input = event && event.target;
    const file = input && input.files ? input.files[0] : null;
    try {
      if (input) input.value = '';
    } catch (error) {}
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!file || !pending) return;
    Promise.resolve()
      .then(function () {
        return prepareAvatarFile(file);
      })
      .then(function (prepared) {
        if (!aliveRef.current) {
          closePreparedSource(prepared);
          return;
        }
        requestIdRef.current += 1;
        setRequest({
          id: requestIdRef.current,
          scope: pending.scope,
          side: pending.side,
          kind: prepared.kind,
          source: prepared.source,
          width: prepared.width,
          height: prepared.height,
          plan: prepared.plan || null,
          job: prepared.job || null
        });
      })
      .catch(function (error) {
        warnWithCode(codeOf(error), error);
      });
  };

  // 卸载时释放未关闭的解码 source，并标记异步回调失效。
  React.useEffect(function () {
    aliveRef.current = true;
    return function () {
      aliveRef.current = false;
      closeRequest();
    };
  }, [closeRequest]);

  // M7：卸载/切会话时清理单击消歧定时器与预览/气泡状态。
  React.useEffect(
    function () {
      return function () {
        clearPreviewTimer();
        clickStateRef.current = null;
        setPreview(null);
        setPoke(null);
      };
    },
    [active, sessionId]
  );

  // 会话内容根上的委托监听；root 晚于 bridge 挂载时由 conversationSnapshot 变化触发重绑。
  React.useEffect(
    function () {
      if (!active || sessionId === null || sessionId === undefined) return undefined;
      if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
      let disposed = false;
      let frame = 0;
      const cleanups = [];

      const resolveHit = function (event) {
        try {
          const target = event && event.target;
          if (!target || typeof target.closest !== 'function') return null;
          const row = target.closest('[' + CONTRACT.attrs.flowKind + ']');
          if (!row) return null;
          if (row.hasAttribute('hidden') || row.closest('[hidden]')) return null;
          if (row.getBoundingClientRect().height <= 0) return null;
          const root = row.closest('[' + CONTRACT.attrs.conversationSession + ']');
          if (!root || String(root.dataset.conversationSession) !== String(sessionId)) return null;
          const kind = row.getAttribute(CONTRACT.attrs.flowKind);
          const side = avatarSideForKind(kind);
          if (!side) return null;
          const pseudo = getComputedStyle(row, pseudoElementOf(side));
          const rect = computeAvatarHitRect(
            row.getBoundingClientRect(),
            { display: pseudo.display, width: pseudo.width, height: pseudo.height },
            side
          );
          if (!rect) return null;
          if (!hitTestAvatar(event.clientX, event.clientY, rect)) return null;
          return { row: row, side: side };
        } catch (error) {
          return null;
        }
      };

      const onPointerMove = function (event) {
        if (disposed) return;
        try {
          const hit = resolveHit(event);
          if (!hit) {
            clearHover();
            return;
          }
          const hovered = hoveredRef.current;
          if (hovered.has(hit.row) && hit.row.getAttribute(HOVER_ATTR) === hit.side) return;
          clearHover();
          hovered.add(hit.row);
          hit.row.setAttribute(HOVER_ATTR, hit.side);
        } catch (error) {
          warnWithCode('E_INTERACTION', error);
        }
      };

      const onLeave = function () {
        clearHover();
      };

      const onClick = function (event) {
        if (disposed) return;
        try {
          clearHover();
          if (event.defaultPrevented) return;
          if (typeof event.button === 'number' && event.button !== 0) return;
          const hit = resolveHit(event);
          if (!hit) return;
          const state = snapshotRef.current;
          if (!state || state.paused || !state.data || !state.data.settings || !state.data.settings.enabled) return;
          event.preventDefault();
          event.stopPropagation();
          clearTextSelection();
          const rowKey = hit.row.getAttribute(CONTRACT.attrs.flowKey) || '';
          const decision = nextAvatarClick(clickStateRef.current, hit.side + '|' + rowKey, Date.now());
          clickStateRef.current = decision.state;
          if (decision.action === 'poke') {
            triggerPoke(hit);
            return;
          }
          clearPreviewTimer();
          const pendingPreview = { side: hit.side };
          previewTimerRef.current = setTimeout(function () {
            previewTimerRef.current = 0;
            openPreviewFor(pendingPreview);
          }, POKE_CLICK_WINDOW_MS);
        } catch (error) {
          warnWithCode('E_INTERACTION', error);
        }
      };

      // M7 打磨：头像区域的鼠标按下/双击/文本选择起点阻止默认行为——
      // 浏览器「双击选中文字」发生在 mousedown/dblclick 阶段，只在 click 上 preventDefault 拦不住。
      const onPointerDown = function (event) {
        try {
          if (!event) return;
          lastPointerRef.current = { x: Number(event.clientX), y: Number(event.clientY), at: Date.now() };
        } catch (error) {}
      };

      const onMouseDown = function (event) {
        if (disposed) return;
        try {
          if (typeof event.button === 'number' && event.button !== 0) return;
          const hit = resolveHit(event);
          if (!hit) return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
        } catch (error) {
          warnWithCode('E_INTERACTION', error);
        }
      };

      const onDblClick = function (event) {
        if (disposed) return;
        try {
          const hit = resolveHit(event);
          if (!hit) return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          clearTextSelection();
        } catch (error) {
          warnWithCode('E_INTERACTION', error);
        }
      };

      const onSelectStart = function (event) {
        if (disposed) return;
        try {
          const pointer = lastPointerRef.current;
          if (!pointer || Date.now() - pointer.at > 500) return;
          const hit = resolveHit({ target: event.target, clientX: pointer.x, clientY: pointer.y });
          if (!hit) return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
        } catch (error) {}
      };

      const attach = function () {
        if (disposed) return false;
        const roots = findInteractionRoots(sessionId, CONTRACT.attrs.conversationSession);
        if (roots.length === 0) return false;
        for (const root of roots) {
          try {
            root.addEventListener('pointermove', onPointerMove, { passive: true });
            root.addEventListener('pointerdown', onPointerDown, { passive: true });
            root.addEventListener('pointerleave', onLeave, { passive: true });
            root.addEventListener('pointercancel', onLeave, { passive: true });
            root.addEventListener('click', onClick, true);
            root.addEventListener('mousedown', onMouseDown, true);
            root.addEventListener('dblclick', onDblClick, true);
            root.addEventListener('selectstart', onSelectStart, true);
            cleanups.push(function () {
              try {
                root.removeEventListener('pointermove', onPointerMove, { passive: true });
                root.removeEventListener('pointerdown', onPointerDown, { passive: true });
                root.removeEventListener('pointerleave', onLeave, { passive: true });
                root.removeEventListener('pointercancel', onLeave, { passive: true });
                root.removeEventListener('click', onClick, true);
                root.removeEventListener('mousedown', onMouseDown, true);
                root.removeEventListener('dblclick', onDblClick, true);
                root.removeEventListener('selectstart', onSelectStart, true);
              } catch (error) {}
              try {
                for (const row of Array.from(root.querySelectorAll('[' + HOVER_ATTR + ']'))) row.removeAttribute(HOVER_ATTR);
              } catch (error) {}
            });
          } catch (error) {
            warnWithCode('E_INTERACTION', error);
          }
        }
        try {
          window.addEventListener('scroll', onLeave, { capture: true, passive: true });
          cleanups.push(function () {
            try {
              window.removeEventListener('scroll', onLeave, { capture: true, passive: true });
            } catch (error) {}
          });
        } catch (error) {}
        return true;
      };

      if (!attach() && typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(function () {
          try {
            attach();
          } catch (error) {
            warnWithCode('E_INTERACTION', error);
          }
        });
      }

      return function () {
        disposed = true;
        if (frame) {
          try {
            cancelAnimationFrame(frame);
          } catch (error) {}
        }
        for (const cleanup of cleanups.splice(0).reverse()) {
          try {
            cleanup();
          } catch (error) {}
        }
        clearHover();
      };
    },
    [active, sessionId, conversationSnapshot, clearHover, clearTextSelection]
  );

  const requestElement = request
    ? h(CropDialog, {
        key: String(request.id),
        request: request,
        shape: shape,
        scopeHint: request.scope === 'global' ? t('crop.scopeGlobal') : t('crop.scopeWorkspace'),
        onCancel: closeRequest,
        onApply: handleApply
      })
    : null;
  const previewElement = preview
    ? h(AvatarPreviewDialog, {
        key: 'dsh-av-preview-' + String(preview.id),
        info: preview.info,
        scopeText:
          preview.info.scope === 'workspace'
            ? t('preview.scopeWorkspace')
            : preview.info.scope === 'global'
              ? t('preview.scopeGlobal')
              : t('preview.scopeDefault'),
        pokeText: preview.pokeText,
        onClose: closePreview,
        onReplace: handleReplaceAvatar,
        onPokeSound: function () {
          playPokeFor(preview.side);
        }
      })
    : null;
  const pokeElement = h(PokeLayer, {
    poke: poke,
    onDone: function () {
      setPoke(null);
    }
  });
  const Fragment = React.Fragment || 'span';
  return h(
    Fragment,
    null,
    h('input', {
      ref: inputRef,
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      className: 'dsh-av-interaction-input',
      style: { display: 'none' },
      onChange: handleFile
    }),
    requestElement,
    previewElement,
    pokeElement
  );
}
