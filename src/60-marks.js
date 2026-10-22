/**
 * @module 60-marks（M4-1 纯函数）
 * 职责：「每回合每侧只显示一次」头像标记纯函数（M4-2 增量标注与 M4-3 设置项使用）。
 * 依赖：contract（kind 常量）。
 * 被依赖：bridge（M4-2 标注层，first-per-turn 实验模式下启用）。
 * 状态：M4-1 纯函数 + M4-2 增量标注层 + M4-3 设置项均已实现；默认 every-step，first-per-turn 为实验项。
 */

// @chat-avatars-marks:start
/** 行 kind -> 标记侧；assistant 侧统一输出 'assistant'，非头像行返回 null。 */
function avatarMarkSide(kind) {
  if (kind === CONTRACT.kinds.user) return 'user';
  if (kind === CONTRACT.kinds.steering) return 'steering';
  if (kind === CONTRACT.kinds.assistant) return 'assistant';
  return null;
}

/**
 * 计算「每回合每侧第一个可见行」标记（纯函数）。
 * 输入 rows: Array<{ kind, turn, visible }>；输出等长数组，元素为 'user' | 'steering' | 'assistant' | null。
 * - 非头像行与不可见行 -> null，且不占用该回合该侧的首个名额；
 * - 同一 turn + 同一侧只标记第一个可见行；turn 缺失（null/undefined）时每行独立成组，避免互相吞并；
 * - 连续用户消息同回合只一次；user 与 steering 分属不同标记，各自各一次。
 */
function computeAvatarMarks(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const seen = Object.create(null);
  const marks = new Array(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || !row.visible) {
      marks[index] = null;
      continue;
    }
    const side = avatarMarkSide(row.kind);
    if (!side) {
      marks[index] = null;
      continue;
    }
    // turn 缺失时用下标独立成键：未知分组信息时不强行合并，避免吞掉后续头像。
    const turnKey = row.turn === null || row.turn === undefined ? '#' + index : String(row.turn);
    const key = side + '|' + turnKey;
    if (seen[key]) {
      marks[index] = null;
      continue;
    }
    seen[key] = true;
    marks[index] = side;
  }
  return marks;
}
// @chat-avatars-marks:end

const MARK_ATTR = 'data-dsh-av-mark';
const AI_MODE_ATTR = 'data-dsh-av-ai-mode';
const AI_MODE_FIRST_PER_TURN = 'first-per-turn';
const MARK_OBSERVE_ATTRS = Object.freeze([
  'hidden',
  'data-chat-turn',
  'data-chat-flow-kind',
  'data-turn-process-hidden',
  'data-chat-group-part'
]);

/** 按 sessionId 找会话内容根（与 bridge 相同契约；模块内自包含以便 M4-2 独立使用）。 */
function findMarkRoots(sessionId) {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') return [];
    if (sessionId === null || sessionId === undefined) return [];
    const nodes = document.querySelectorAll('[' + CONTRACT.attrs.conversationSession + ']');
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

/**
 * 把当前 DOM 行映射成 computeAvatarMarks 的输入。
 * visible 只读 hidden 属性祖先（与 CSS :not([hidden]) 过滤严格一致），不读布局：避免 2000 行批处理时
 * offsetParent 强制 reflow（M4 有限测量发现该读取会放大长任务）。data-turn-process-hidden 只作样式标记，
 * 当前 CSS 不隐藏它，因此不作为不可见条件（否则会把可显示行误判）。
 */
function collectMarkInputs(rows) {
  const inputs = [];
  for (const row of rows) {
    try {
      const kind = row.getAttribute(CONTRACT.attrs.flowKind);
      if (!kind) continue;
      const visible = !row.closest('[hidden]');
      inputs.push({ kind: kind, turn: row.getAttribute('data-chat-turn'), visible: visible });
    } catch (error) {}
  }
  return inputs;
}

/** 对单个会话根应用标记：只有 assistant 首个可见行带 data-dsh-av-mark="assistant"。 */
function applyAvatarMarks(root) {
  const rows = Array.from(root.querySelectorAll('[' + CONTRACT.attrs.flowKind + ']'));
  const marks = computeAvatarMarks(collectMarkInputs(rows));
  let changed = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    try {
      if (marks[index] === 'assistant') {
        if (row.getAttribute(MARK_ATTR) !== 'assistant') {
          row.setAttribute(MARK_ATTR, 'assistant');
          changed += 1;
        }
      } else if (row.hasAttribute(MARK_ATTR)) {
        row.removeAttribute(MARK_ATTR);
        changed += 1;
      }
    } catch (error) {}
  }
  return changed;
}

/**
 * 增量标注层（M4-2）：仅当 aiAvatarMode=first-per-turn 时激活。
 * 只观察会话内容根的 childList/相关属性，rAF 合并；根上设置 data-dsh-av-ai-mode 供 CSS 消费。
 * 关闭/卸载时断开 observer、取消 rAF、移除根属性与所有行标记（不残留）。
 */
function AvatarMarkLayer(props) {
  const sessionId = props && props.sessionId;
  const mode = props && props.mode === AI_MODE_FIRST_PER_TURN ? AI_MODE_FIRST_PER_TURN : 'every-step';
  const conversationSnapshot = props && props.conversationSnapshot;
  const active = mode === AI_MODE_FIRST_PER_TURN && sessionId !== null && sessionId !== undefined;

  React.useEffect(
    function () {
      if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
      if (!active) return undefined;
      const roots = [];
      const observers = [];
      let frame = 0;
      let disposed = false;

      const removeRootMarks = function (root) {
        try {
          root.removeAttribute(AI_MODE_ATTR);
        } catch (error) {}
        try {
          const marked = root.querySelectorAll('[' + MARK_ATTR + ']');
          for (let index = 0; index < marked.length; index += 1) marked[index].removeAttribute(MARK_ATTR);
        } catch (error) {}
      };

      const applyAll = function () {
        if (disposed) return;
        try {
          for (const root of roots) applyAvatarMarks(root);
        } catch (error) {
          warnWithCode('E_MARKS', error);
        }
      };

      const schedule = function () {
        if (disposed || frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          applyAll();
        });
      };

      const attach = function () {
        if (disposed) return false;
        const found = findMarkRoots(sessionId);
        if (found.length === 0) return false;
        for (const root of found) {
          if (roots.indexOf(root) >= 0) continue;
          roots.push(root);
          try {
            root.setAttribute(AI_MODE_ATTR, AI_MODE_FIRST_PER_TURN);
          } catch (error) {}
          try {
            const observer = new MutationObserver(schedule);
            observer.observe(root, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: MARK_OBSERVE_ATTRS.slice()
            });
            observers.push(observer);
          } catch (error) {
            warnWithCode('E_MARKS', error);
          }
        }
        applyAll();
        return true;
      };

      if (!attach()) {
        frame = requestAnimationFrame(function () {
          frame = 0;
          try {
            if (attach()) schedule();
          } catch (error) {
            warnWithCode('E_MARKS', error);
          }
        });
      }

      return function () {
        disposed = true;
        if (frame) {
          try {
            cancelAnimationFrame(frame);
          } catch (error) {}
          frame = 0;
        }
        for (const observer of observers.splice(0)) {
          try {
            observer.disconnect();
          } catch (error) {}
        }
        for (const root of roots.splice(0)) removeRootMarks(root);
      };
    },
    [active, sessionId, conversationSnapshot]
  );

  return null;
}
