/**
 * @module 66-avatar-preview
 * 职责：M7 大图预览——来源/显示信息纯函数 + 原生 <dialog> 预览浮窗（动图继续用 CSS steps 播放）；
 *       预览内「更换头像」走 65-interaction 的 file input → M2 裁剪；「拍一拍」为纯本地效果。
 * 依赖：contract / i18n / status（warnWithCode）/ 67-poke（playPokeSound、抖动关键帧/文案由调用方提供）。
 * 被依赖：65-interaction（单击头像时渲染）。
 * 状态：M7 新增；不写 document.body、不新增 slot；关闭/卸载由父层控制。
 */

const PREVIEW_SIZE_PX = 208;

// @chat-avatars-avatar-preview:start
/**
 * 预览显示信息：workspace 覆盖 → 全局 → 内置默认（与 resolveEffectiveAvatar 同一优先级，但额外返回来源）。
 * 返回 { side, image, animated, scope: 'workspace'|'global'|'default', label, shape, radius } 或 null。
 */
function resolvePreviewInfo(data, workspaceId, side, defaults) {
  if (side !== 'user' && side !== 'assistant') return null;
  const source = data && typeof data === 'object' ? data : null;
  const settings = source && source.settings && typeof source.settings === 'object' ? source.settings : {};
  const workspaces =
    source && source.workspaces && typeof source.workspaces === 'object' && !Array.isArray(source.workspaces)
      ? source.workspaces
      : {};
  const entry = workspaceId !== null && workspaceId !== undefined ? workspaces[String(workspaceId)] || null : null;
  let value = null;
  let scope = 'default';
  if (entry && validAvatar(entry[side])) {
    value = entry[side];
    scope = 'workspace';
  } else if (source && source.global && validAvatar(source.global[side])) {
    value = source.global[side];
    scope = 'global';
  }
  const animated = value !== null && typeof value === 'object' ? { frames: value.frames, frameMs: value.frameMs } : null;
  const image = value === null ? null : typeof value === 'string' ? value : value.src;
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};
  const label = typeof fallback[side] === 'string' ? fallback[side] : side === 'user' ? 'You' : 'DS';
  return {
    side: side,
    image: image,
    animated: animated,
    scope: scope,
    label: label,
    shape: settings.shape === 'rounded' ? 'rounded' : 'circle'
  };
}

/** 预览头像内联样式：静态 cover；动图 auto 100% + steps 动画（内联变量，不依赖会话根）。 */
function buildPreviewStyle(info) {
  const shape = info && info.shape === 'rounded' ? 'rounded' : 'circle';
  const animated = info && info.animated ? info.animated : null;
  const side = info && info.side === 'assistant' ? 'assistant' : 'user';
  const image = info && info.image ? info.image : null;
  // 窄屏下大图预览收缩到 60vw，避免 208px 固定尺寸溢出；动画位移同时使用该尺寸变量。
  const size = 'min(' + PREVIEW_SIZE_PX + 'px, 60vw)';
  const style = {
    width: size,
    height: size,
    borderRadius: shape === 'rounded' ? '22%' : '999px',
    backgroundImage: image ? 'url("' + image + '")' : 'none',
    '--dsh-av-preview-size': size
  };
  if (!image) {
    // 内置默认头像（无图片）：用品牌色/主题色 + 首字母 fallback，避免预览出现空白透明圆。
    style.display = 'flex';
    style.alignItems = 'center';
    style.justifyContent = 'center';
    style.backgroundColor =
      side === 'user'
        ? 'var(--dsw-alias-brand-primary, #6d5efc)'
        : 'var(--dsw-alias-bg-layer-2, #1f1f24)';
    style.backgroundImage =
      side === 'user'
        ? 'linear-gradient(135deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .12))'
        : 'linear-gradient(135deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .08))';
    style.color =
      side === 'user'
        ? 'var(--dsw-alias-bg-base, #fff)'
        : 'var(--dsw-alias-label-primary, #fff)';
    style.fontSize = '44px';
    style.fontWeight = '600';
    style.lineHeight = '1';
  }
  if (animated && animated.frames > 0 && animated.frameMs > 0) {
    style.backgroundSize = 'auto 100%';
    style.backgroundPosition = '0 0';
    style['--dsh-av-preview-frames'] = String(animated.frames);
    style.animation =
      'dsh-av-preview-play ' + String(animated.frames * animated.frameMs) + 'ms steps(' + String(animated.frames) + ') infinite';
  } else {
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
    style.animation = 'none';
  }
  return style;
}
// @chat-avatars-avatar-preview:end

// @chat-avatars-preview-theme:start
/**
 * 解析预览主题：优先使用宿主主题 token 的亮度，失败再看根/body 背景，最后回退系统 color-scheme。
 * 桌面端 top-layer 可能拿不到完整宿主变量；浅色主题下需要明确的实色背景、轻阴影与浅色遮罩。
 */
function parsePreviewColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || text === 'transparent') return null;
  const hex = text.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(function (c) { return c + c; }).join('');
    if (raw.length !== 6 && raw.length !== 8) return null;
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    return { r: r, g: g, b: b, a: a };
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)\s*)?\)$/i);
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
      a: rgb[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgb[4])))
    };
  }
  return null;
}

function previewLuminance(color) {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function resolvePreviewTheme() {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 'dark';
    const root = document.documentElement;
    if (root) {
      const rootStyle = getComputedStyle(root);
      const names = ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-base'];
      for (const name of names) {
        const color = parsePreviewColor(rootStyle.getPropertyValue(name));
        if (color && color.a > 0.1) return previewLuminance(color) >= 0.5 ? 'light' : 'dark';
      }
    }
    const targets = [document.body, root];
    for (const target of targets) {
      if (!target) continue;
      const background = parsePreviewColor(getComputedStyle(target).backgroundColor);
      if (background && background.a > 0.1) return previewLuminance(background) >= 0.5 ? 'light' : 'dark';
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch (error) {}
  return 'dark';
}
// @chat-avatars-preview-theme:end

/**
 * 大图预览对话框（原生 dialog showModal，top-layer）。
 * props：info = resolvePreviewInfo(...) 结果、scopeText、pokeTexts（随机文案候选）、
 *        pokeText（兼容旧调用的单条文案）、onClose/onReplace/onPokeSound。
 */
function AvatarPreviewDialog(props) {
  const info = props.info;
  const theme = resolvePreviewTheme();
  const dialogRef = React.useRef(null);
  const pokeTimerRef = React.useRef(0);
  const pokeState = React.useState(false);
  const poking = pokeState[0];
  const setPoking = pokeState[1];
  const pokeTexts = Array.isArray(props.pokeTexts) ? props.pokeTexts : [];
  const pokeTextState = React.useState(function () {
    return pickPokeText(pokeTexts, '', Math.random) || props.pokeText || '';
  });
  const pokeText = pokeTextState[0];
  const setPokeText = pokeTextState[1];
  const pokeIdState = React.useState(0);
  const pokeId = pokeIdState[0];
  const setPokeId = pokeIdState[1];
  const lastPokeTextRef = React.useRef(pokeText);

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
      warnWithCode('E_PREVIEW', error);
    }
    try {
      if (dialog && typeof dialog.focus === 'function') dialog.focus();
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

  React.useEffect(function () {
    return function () {
      if (pokeTimerRef.current) {
        try {
          clearTimeout(pokeTimerRef.current);
        } catch (error) {}
      }
    };
  }, []);

  const onPoke = function () {
    try {
      const next = pickPokeText(pokeTexts, lastPokeTextRef.current, Math.random) || props.pokeText || '';
      lastPokeTextRef.current = next;
      setPokeText(next);
      setPokeId(pokeId + 1);
      setPoking(true);
      if (pokeTimerRef.current) clearTimeout(pokeTimerRef.current);
      pokeTimerRef.current = setTimeout(function () {
        setPoking(false);
      }, 1200);
      if (props.onPokeSound) props.onPokeSound();
    } catch (error) {
      warnWithCode('E_PREVIEW', error);
    }
  };

  const style = buildPreviewStyle(info);
  const className = 'dsh-av-preview-avatar' + (info.animated ? ' is-animated' : '') + (poking ? ' is-poking' : '');

  return h(
    'dialog',
    {
      ref: dialogRef,
      className: 'dsh-av-preview-dialog',
      'data-dsh-av-theme': theme,
      'aria-label': t('preview.title'),
      onCancel: function (event) {
        try {
          event.preventDefault();
        } catch (error) {}
        if (props.onClose) props.onClose();
      },
      onClick: function (event) {
        try {
          if (event.target === dialogRef.current && props.onClose) props.onClose();
        } catch (error) {}
      }
    },
    h(
      'div',
      { className: 'dsh-av-preview-card' },
      h(
        'div',
        { className: 'dsh-av-preview-stage' },
        h(
          'div',
          { className: className, style: style, role: 'img', 'aria-label': info.label },
          info.image
            ? null
            : h('span', { className: 'dsh-av-preview-fallback', 'aria-hidden': 'true' }, info.label)
        )
      ),
      poking
        ? h(
            'div',
            { key: 'poke-chip-' + String(pokeId), className: 'dsh-av-preview-poke-chip' },
            h('span', { className: 'dsh-av-preview-poke-sparkle', 'aria-hidden': 'true' }, '✦'),
            h('span', { className: 'dsh-av-preview-poke-text' }, pokeText)
          )
        : null,
      h('div', { className: 'dsh-av-preview-name' }, info.label),
      h('div', { className: 'dsh-av-preview-scope' }, props.scopeText || ''),
      h(
        'div',
        { className: 'dsh-av-preview-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-av-btn',
            onClick: function () {
              if (props.onClose) props.onClose();
            }
          },
          t('preview.close')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-av-btn',
            onClick: function () {
              if (props.onReplace) props.onReplace();
            }
          },
          t('preview.change')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-av-btn dsh-av-btn-primary',
            onClick: onPoke
          },
          t('preview.poke')
        )
      )
    )
  );
}
