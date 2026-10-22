/**
 * @module 67-poke
 * 职责：M7 拍一拍——单击/双击消歧纯函数、气泡定位纯函数、文案解析、WebAudio 合成音效、PokeLayer 组件；
 *       纯本地效果：不写会话事件、不联网、不通知对方。
 * 依赖：contract / status（warnWithCode）/ i18n（文案由调用方传入默认值）/ storage（sanitizePokeText）。
 * 被依赖：65-interaction（触发/渲染）、66-avatar-preview（预览内拍一拍）、80-settings（试听）。
 * 状态：M7 新增。所有 DOM/音频副作用均包 try/catch，组件卸载清理定时器、行属性与音频上下文。
 */

const POKE_CLICK_WINDOW_MS = 260;
const POKE_COOLDOWN_MS = 900;
const POKE_BUBBLE_MS = 2200;
const POKE_SHAKE_MS = 520;
const POKE_BUBBLE_GAP = 10;
const POKE_BUBBLE_MARGIN = 8;

// @chat-avatars-poke:start
/** 数值 clamp；非法回落 fallback。 */
function clampPokeValue(value, min, max, fallback) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** 拍一拍音效音量（0–100 整数；非法回落 60）。 */
function resolvePokeVolume(poke) {
  const source = poke && typeof poke === 'object' ? poke : {};
  const value = Number(source.volume);
  if (!isFinite(value)) return 60;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 拍一拍文案：自定义优先，空串回落到本地化默认文案。 */
function resolvePokeText(poke, side, defaults) {
  if (side !== 'user' && side !== 'assistant') return '';
  const source = poke && typeof poke === 'object' ? poke : {};
  const raw = side === 'user' ? source.userText : source.assistantText;
  const custom = typeof sanitizePokeText === 'function' ? sanitizePokeText(raw) : '';
  if (custom) return custom;
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};
  const text = side === 'user' ? fallback.user : fallback.assistant;
  return typeof text === 'string' ? text : '';
}

/**
 * 单击/双击消歧状态机：
 * - 同一行同一侧、距上次 click ≤ CLICK_WINDOW_MS -> poke（并清空状态，避免三连击误判）
 * - 其余 -> preview（记录本次 click 作为下一次双击判定的起点）
 * 返回 { action: 'poke' | 'preview', state }；state 供调用方原样保存。
 */
function nextAvatarClick(state, key, nowMs) {
  const previous = state && typeof state === 'object' ? state : null;
  const keyText = key === undefined || key === null ? '' : String(key);
  const now = Number(nowMs);
  if (
    previous &&
    previous.key === keyText &&
    isFinite(now) &&
    isFinite(previous.at) &&
    now >= previous.at &&
    now - previous.at <= POKE_CLICK_WINDOW_MS
  ) {
    return { action: 'poke', state: { key: '', at: 0 } };
  }
  return { action: 'preview', state: { key: keyText, at: isFinite(now) ? now : 0 } };
}

/** 冷却判断：距上次拍一拍不足 COOLDOWN_MS 时忽略触发。 */
function pokeCoolingDown(lastPokeAt, nowMs) {
  const last = Number(lastPokeAt);
  const now = Number(nowMs);
  if (!isFinite(last) || !isFinite(now) || last <= 0 || now < last) return false;
  return now - last < POKE_COOLDOWN_MS;
}

/**
 * 气泡定位：anchor = 头像命中矩形，bubble = 气泡实际尺寸，viewport = 视口。
 * 横向：user 侧气泡在头像左侧，assistant 侧在右侧，均夹取到视口内；
 * 纵向：优先在头像上方，空间不足翻到下方；尾巴相对气泡左边缘的偏移夹取在圆角内。
 * 返回 { left, top, placement: 'above'|'below', tail }；输入非法返回 null。
 */
function computeBubblePlacement(anchorRect, bubbleSize, viewport, side) {
  const anchor = anchorRect && typeof anchorRect === 'object' ? anchorRect : null;
  const bubble = bubbleSize && typeof bubbleSize === 'object' ? bubbleSize : null;
  const view = viewport && typeof viewport === 'object' ? viewport : null;
  if (!anchor || !bubble || !view) return null;
  if (side !== 'user' && side !== 'assistant') return null;
  const anchorX = Number(anchor.x);
  const anchorY = Number(anchor.y);
  const anchorW = Number(anchor.width);
  const anchorH = Number(anchor.height);
  const bubbleW = Number(bubble.width);
  const bubbleH = Number(bubble.height);
  const viewW = Number(view.width);
  const viewH = Number(view.height);
  if (![anchorX, anchorY, anchorW, anchorH, bubbleW, bubbleH, viewW, viewH].every((value) => isFinite(value))) {
    return null;
  }
  if (anchorW <= 0 || anchorH <= 0 || bubbleW <= 0 || bubbleH <= 0 || viewW <= 0 || viewH <= 0) return null;
  const gap = POKE_BUBBLE_GAP;
  let placement = 'above';
  let top = anchorY - bubbleH - gap;
  if (top < POKE_BUBBLE_MARGIN) {
    placement = 'below';
    top = anchorY + anchorH + gap;
  }
  top = Math.max(POKE_BUBBLE_MARGIN, Math.min(top, viewH - bubbleH - POKE_BUBBLE_MARGIN));
  // 横向与头像对齐：user 侧气泡右缘贴头像右缘，assistant 侧左缘贴头像左缘——
  // 视觉上「从头像头顶冒出」，不再横插在消息文本中间。
  let left = side === 'user' ? anchorX + anchorW - bubbleW : anchorX;
  left = Math.max(POKE_BUBBLE_MARGIN, Math.min(left, viewW - bubbleW - POKE_BUBBLE_MARGIN));
  const anchorCenter = anchorX + anchorW / 2;
  const tail = Math.max(20, Math.min(bubbleW - 20, anchorCenter - left));
  return { left: Math.round(left), top: Math.round(top), placement: placement, tail: Math.round(tail) };
}
// @chat-avatars-poke:end

/** 懒创建共享 AudioContext；仅在用户手势内调用（双击/试听按钮）。 */
let pokeAudioContext = null;
let pokeAudioDisabled = false;

function getPokeAudioContext() {
  try {
    if (pokeAudioContext || pokeAudioDisabled) return pokeAudioContext;
    const Ctor =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : typeof webkitAudioContext !== 'undefined'
          ? webkitAudioContext
          : null;
    if (!Ctor) {
      pokeAudioDisabled = true;
      return null;
    }
    pokeAudioContext = new Ctor();
  } catch (error) {
    pokeAudioDisabled = true;
    pokeAudioContext = null;
  }
  return pokeAudioContext;
}

/** 合成「叮—咚」：两个正弦音、指数衰减；失败静默。volume 0–100。 */
function playPokeSound(volume) {
  try {
    const context = getPokeAudioContext();
    if (!context) return false;
    if (context.state === 'suspended' && typeof context.resume === 'function') {
      Promise.resolve(context.resume()).catch(function () {});
    }
    const level = resolvePokeVolume({ volume: volume }) / 100;
    if (!(level > 0)) return false;
    const gainPeak = 0.14 * level;
    const start = context.currentTime;
    const notes = [
      { frequency: 1046.5, offset: 0, decay: 0.2 },
      { frequency: 1568.0, offset: 0.06, decay: 0.22 }
    ];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;
      const at = start + note.offset;
      try {
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(gainPeak, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note.decay);
      } catch (error) {}
      oscillator.connect(gain);
      gain.connect(context.destination);
      try {
        oscillator.start(at);
        oscillator.stop(at + note.decay + 0.02);
      } catch (error) {}
    }
    return true;
  } catch (error) {
    return false;
  }
}

/** 插件卸载/禁用时关闭音频上下文（best-effort）。 */
function disposePokeAudio() {
  try {
    if (pokeAudioContext && pokeAudioContext.state !== 'closed' && typeof pokeAudioContext.close === 'function') {
      Promise.resolve(pokeAudioContext.close()).catch(function () {});
    }
  } catch (error) {}
  pokeAudioContext = null;
}

/**
 * PokeLayer：渲染一个拍一拍气泡，并给被点行加 `data-dsh-av-poke` 触发抖动。
 * props: poke = { id, side, text, anchor, row } | null；onDone(id) 在气泡到时后回调。
 * 清理：卸载/换 poke 时移除行属性、清除定时器；animationend 提前移除属性，超时兜底。
 */
function PokeLayer(props) {
  const poke = props.poke || null;
  const bubbleRef = React.useRef(null);
  const placementState = React.useState(null);
  const placement = placementState[0];
  const setPlacement = placementState[1];
  const onDoneRef = React.useRef(props.onDone);
  onDoneRef.current = props.onDone;
  const pokeId = poke ? poke.id : null;

  React.useLayoutEffect(
    function () {
      if (!poke) return;
      try {
        const bubble = bubbleRef.current;
        if (!bubble || typeof bubble.getBoundingClientRect !== 'function') return;
        // 注意：气泡入场动画带 scale(.8)/translate，getBoundingClientRect 量到的是变换后的尺寸，
        // 会让定位与头像错位；用 offsetWidth/offsetHeight（布局尺寸，不受 transform 影响）。
        const rect = bubble.getBoundingClientRect();
        const width = bubble.offsetWidth > 0 ? bubble.offsetWidth : rect.width;
        const height = bubble.offsetHeight > 0 ? bubble.offsetHeight : rect.height;
        const next = computeBubblePlacement(
          poke.anchor,
          { width: width, height: height },
          { width: typeof window !== 'undefined' ? window.innerWidth : 0, height: typeof window !== 'undefined' ? window.innerHeight : 0 },
          poke.side
        );
        if (next) setPlacement(next);
      } catch (error) {
        warnWithCode('E_POKE', error);
      }
    },
    [pokeId]
  );

  React.useEffect(
    function () {
      if (!poke) {
        setPlacement(null);
        return undefined;
      }
      let disposed = false;
      const row = poke.row;
      const removeRowAttr = function () {
        try {
          if (row && typeof row.removeAttribute === 'function') row.removeAttribute(CONTRACT.attrs.poke);
        } catch (error) {}
      };
      try {
        if (row && typeof row.setAttribute === 'function') row.setAttribute(CONTRACT.attrs.poke, poke.side);
      } catch (error) {
        warnWithCode('E_POKE', error);
      }
      const attrTimer = setTimeout(removeRowAttr, POKE_SHAKE_MS + 140);
      const dismissTimer = setTimeout(function () {
        if (disposed) return;
        try {
          if (onDoneRef.current) onDoneRef.current(poke.id);
        } catch (error) {}
      }, POKE_BUBBLE_MS);
      const onAnimationEnd = function (event) {
        try {
          if (event && event.target === row) removeRowAttr();
        } catch (error) {}
      };
      try {
        if (row && typeof row.addEventListener === 'function') row.addEventListener('animationend', onAnimationEnd);
      } catch (error) {}
      return function () {
        disposed = true;
        clearTimeout(attrTimer);
        clearTimeout(dismissTimer);
        try {
          if (row && typeof row.removeEventListener === 'function') row.removeEventListener('animationend', onAnimationEnd);
        } catch (error) {}
        removeRowAttr();
      };
    },
    [pokeId]
  );

  if (!poke) return null;
  const sideClass = poke.side === 'user' ? ' is-user' : ' is-assistant';
  const className =
    'dsh-av-poke-bubble' +
    (placement ? ' is-placed' : '') +
    (placement && placement.placement === 'below' ? ' is-below' : ' is-above') +
    sideClass;
  const style = placement
    ? {
        left: placement.left + 'px',
        top: placement.top + 'px',
        '--dsh-av-poke-tail': placement.tail + 'px'
      }
    : { left: '0px', top: '0px', visibility: 'hidden' };
  const burstStyle = {
    left: Math.round(poke.anchor.x + poke.anchor.width / 2) + 'px',
    top: Math.round(poke.anchor.y + poke.anchor.height / 2) + 'px'
  };
  const Fragment = React.Fragment || 'span';
  return h(
    Fragment,
    null,
    placement
      ? h(
          'div',
          { className: 'dsh-av-poke-burst' + sideClass, style: burstStyle, 'aria-hidden': 'true' },
          h('span', { className: 'dsh-av-poke-dot is-1' }),
          h('span', { className: 'dsh-av-poke-dot is-2' }),
          h('span', { className: 'dsh-av-poke-dot is-3' }),
          h('span', { className: 'dsh-av-poke-spark is-4' })
        )
      : null,
    h(
      'div',
      {
        ref: bubbleRef,
        className: className,
        style: style,
        role: 'status',
        'aria-live': 'polite'
      },
      h('span', { className: 'dsh-av-poke-sparkle', 'aria-hidden': 'true' }, '✦'),
      h('span', { className: 'dsh-av-poke-text' }, poke.text)
    )
  );
}
