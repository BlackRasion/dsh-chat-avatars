/**
 * @module 75-bridge
 * 职责：会话桥——sessionId → workspaceId → 有效头像 → 会话内容根 CSS 变量；owner token 防多实例互删。
 * 依赖：contract / store / status / i18n。
 * 被依赖：apply（注册到 contract.slots.bridge）。
 * 状态：M1-3 已实现。变量写到 [data-conversation-session] 会话内容根（v2 P0-2，不再写 documentElement）；
 *       暂停/总开关关闭/无会话时清除本实例写入的变量（不写变量 = 原生界面）。
 */
// @chat-avatars-bridge:start
const AV_VAR_NAMES = Object.freeze({
  user: Object.freeze({
    size: CONTRACT.vars.userSize,
    show: CONTRACT.vars.userShow,
    display: CONTRACT.vars.userDisplay,
    image: CONTRACT.vars.userImage,
    label: CONTRACT.vars.userLabel,
    frames: CONTRACT.vars.userFrames,
    anim: CONTRACT.vars.userAnim
  }),
  assistant: Object.freeze({
    size: CONTRACT.vars.assistantSize,
    show: CONTRACT.vars.assistantShow,
    display: CONTRACT.vars.assistantDisplay,
    image: CONTRACT.vars.assistantImage,
    label: CONTRACT.vars.assistantLabel,
    frames: CONTRACT.vars.assistantFrames,
    anim: CONTRACT.vars.assistantAnim
  }),
  radius: CONTRACT.vars.radius
});

// M5：动图播放状态写在会话内容根（CSS 只在根属性存在时启用 snowflake 播放/冻结首帧）。
const AV_ROOT_ATTRS = Object.freeze({
  user: CONTRACT.attrs.animUser,
  assistant: CONTRACT.attrs.animAssistant
});

const AV_ALL_VAR_NAMES = Object.freeze([
  CONTRACT.vars.userSize,
  CONTRACT.vars.assistantSize,
  CONTRACT.vars.userShow,
  CONTRACT.vars.assistantShow,
  CONTRACT.vars.userDisplay,
  CONTRACT.vars.assistantDisplay,
  CONTRACT.vars.userImage,
  CONTRACT.vars.assistantImage,
  CONTRACT.vars.userLabel,
  CONTRACT.vars.assistantLabel,
  CONTRACT.vars.userFrames,
  CONTRACT.vars.assistantFrames,
  CONTRACT.vars.userAnim,
  CONTRACT.vars.assistantAnim,
  CONTRACT.vars.radius
]);

// 每个会话内容根当前归属的 owner token；多视图/多实例时避免互相清除变量。
const avatarVarOwners = new Map();
let nextAvatarOwnerId = 0;

/** 在 WorkspaceSnapshot.items 里找包含当前 session 的工作区；找不到返回 null。 */
function pickWorkspaceId(workspaceSnapshot, sessionId) {
  try {
    if (sessionId === null || sessionId === undefined) return null;
    if (!workspaceSnapshot || !Array.isArray(workspaceSnapshot.items)) return null;
    const key = String(sessionId);
    for (const workspace of workspaceSnapshot.items) {
      if (!workspace || !Array.isArray(workspace.sessionIds)) continue;
      if (workspace.sessionIds.some((id) => String(id) === key)) {
        return workspace.workspaceId !== undefined ? workspace.workspaceId : null;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/** 按 sessionId 找所有会话内容根（宿主契约：[data-conversation-session]）。 */
function findSessionRoots(sessionId) {
  try {
    if (sessionId === null || sessionId === undefined) return [];
    if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') return [];
    const nodes = document.querySelectorAll('[' + CONTRACT.attrs.conversationSession + ']');
    if (!nodes || typeof nodes.length !== 'number') return [];
    const key = String(sessionId);
    const roots = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || !node.dataset) continue;
      if (String(node.dataset.conversationSession) === key) roots.push(node);
    }
    return roots;
  } catch (error) {
    return [];
  }
}

/** 有效头像 → [变量名, 值] 列表（纯函数，便于单测）。 */
function buildAvatarVarAssignments(effective) {
  if (!effective || !effective.enabled) return [];
  const size = String(effective.size) + 'px';
  const assignments = [];
  for (const side of CONTRACT.sides) {
    const part = effective[side] || null;
    if (!part) continue;
    const names = AV_VAR_NAMES[side];
    const animated = part.animated || null;
    assignments.push([names.size, size]);
    assignments.push([names.show, part.show ? '1' : '0']);
    assignments.push([names.display, part.show ? 'flex' : 'none']);
    assignments.push([names.image, part.image ? 'url("' + part.image + '")' : 'none']);
    assignments.push([names.label, JSON.stringify(part.label || '')]);
    assignments.push([names.frames, animated ? String(animated.frames) : '1']);
    assignments.push([
      names.anim,
      animated
        ? 'dsh-av-play-' + side + ' ' + String(animated.frames * animated.frameMs) + 'ms steps(' + String(animated.frames) + ') infinite'
        : 'none'
    ]);
  }
  assignments.push([AV_VAR_NAMES.radius, effective.shape === 'rounded' ? 'calc(' + size + ' * 0.22)' : '999px']);
  return assignments;
}

/** 有效头像 → 根属性列表（动图侧才写 data-dsh-av-anim-*；纯函数，便于单测）。 */
function buildAvatarRootAttrs(effective) {
  if (!effective || !effective.enabled) return [];
  const attrs = [];
  for (const side of CONTRACT.sides) {
    const part = effective[side];
    if (part && part.animated) attrs.push([AV_ROOT_ATTRS[side], '1']);
  }
  return attrs;
}

/** 按列表设置/移除两侧根属性（未在列表中的侧移除，静态切换无残留）。 */
function applyAvatarRootAttrs(root, attrs) {
  if (!root || typeof root.setAttribute !== 'function' || typeof root.removeAttribute !== 'function') return false;
  try {
    const wanted = new Map(attrs || []);
    for (const side of CONTRACT.sides) {
      const name = AV_ROOT_ATTRS[side];
      if (wanted.has(name)) root.setAttribute(name, String(wanted.get(name)));
      else root.removeAttribute(name);
    }
    return true;
  } catch (error) {
    return false;
  }
}

function clearAvatarRootAttrs(root) {
  return applyAvatarRootAttrs(root, []);
}

function writeAvatarVars(root, assignments) {
  if (!root || !root.style || typeof root.style.setProperty !== 'function') return false;
  try {
    for (const pair of assignments) root.style.setProperty(pair[0], pair[1]);
    return true;
  } catch (error) {
    return false;
  }
}

function clearAvatarVars(root) {
  if (!root || !root.style || typeof root.style.removeProperty !== 'function') return false;
  try {
    for (const name of AV_ALL_VAR_NAMES) root.style.removeProperty(name);
    return true;
  } catch (error) {
    return false;
  }
}

function createAvatarOwnerToken() {
  nextAvatarOwnerId += 1;
  return { id: nextAvatarOwnerId };
}

function claimAvatarVars(root, token) {
  if (!root || !token) return;
  avatarVarOwners.set(root, token);
}

/** 只有仍持有该根所有权时才清理，避免多实例互删；变量与动图根属性一起清。 */
function releaseAvatarVars(root, token) {
  if (!root || !token) return;
  if (avatarVarOwners.get(root) !== token) return;
  avatarVarOwners.delete(root);
  clearAvatarVars(root);
  clearAvatarRootAttrs(root);
}
// @chat-avatars-bridge:end

/** 订阅 store 快照的 React hook（无订阅者时也安全）。 */
function useStoreSnapshot() {
  const initial = React.useState(getStoreState);
  const snapshot = initial[0];
  const setSnapshot = initial[1];
  React.useEffect(function () {
    return subscribeStore(function () {
      setSnapshot(getStoreState());
    });
  }, []);
  return snapshot;
}

/**
 * 隐藏桥组件：挂在常驻 session header utilities 槽，只写 CSS 变量，返回 null 不产生 DOM。
 * props 来自宿主 standard props：sessionId 与 useWorkspaces（0.2.1-rc.2 已核实）。
 */
function ChatAvatarsBridge(props) {
  const snapshot = useStoreSnapshot();
  useLocaleId();
  const sessionId =
    props && props.sessionId !== undefined && props.sessionId !== null ? props.sessionId : null;
  // 会话数据加载后行才进入 DOM；apply 启动时的探针可能早于会话挂载，需要补一次契约探针。
  let conversationSnapshot = null;
  try {
    if (props && typeof props.useConversation === 'function') {
      conversationSnapshot = props.useConversation(function (conversation) {
        return conversation;
      });
    }
  } catch (error) {
    conversationSnapshot = null;
  }
  const probeRequestedFor = React.useRef(null);
  React.useEffect(
    function () {
      if (sessionId === null) return;
      if (probeRequestedFor.current === sessionId) return;
      const state = getStoreState();
      if (!state || state.contract === 'ok') return;
      const rows =
        typeof document === 'undefined'
          ? 0
          : document.querySelectorAll('[' + CONTRACT.attrs.flowKey + ']').length;
      if (rows === 0) return;
      probeRequestedFor.current = sessionId;
      requestProbe();
    },
    [conversationSnapshot, sessionId]
  );
  const selectWorkspace = React.useCallback(
    function (workspaceSnapshot) {
      return pickWorkspaceId(workspaceSnapshot, sessionId);
    },
    [sessionId]
  );
  let workspaceId = null;
  try {
    if (props && typeof props.useWorkspaces === 'function') {
      workspaceId = props.useWorkspaces(selectWorkspace);
    }
  } catch (error) {
    workspaceId = null;
  }
  React.useEffect(
    function () {
      setCurrentWorkspace(workspaceId);
      return function () {
        setCurrentWorkspace(null);
      };
    },
    [workspaceId]
  );
  const tokenState = React.useState(createAvatarOwnerToken);
  const token = tokenState[0];
  React.useLayoutEffect(
    function () {
      let writtenRoots = [];
      let frame = 0;
      const applyNow = function () {
        const roots = findSessionRoots(sessionId);
        const disabled =
          !snapshot ||
          !snapshot.data ||
          snapshot.paused ||
          !snapshot.data.settings ||
          !snapshot.data.settings.enabled;
        const effective = disabled ? null : resolveEffectiveAvatar(snapshot.data, workspaceId);
        const assignments = effective ? buildAvatarVarAssignments(effective) : [];
        const rootAttrs = effective ? buildAvatarRootAttrs(effective) : [];
        if (assignments.length === 0) {
          for (const root of writtenRoots) releaseAvatarVars(root, token);
          writtenRoots = [];
          return false;
        }
        for (const root of roots) {
          claimAvatarVars(root, token);
          writeAvatarVars(root, assignments);
          // 动图播放状态：静态/单侧动图切换时同步移除另一侧根属性，避免残留动画。
          applyAvatarRootAttrs(root, rootAttrs);
        }
        writtenRoots = roots;
        return roots.length > 0;
      };
      let applied = false;
      try {
        applied = applyNow();
      } catch (error) {
        warnWithCode('E_VARS', error);
      }
      // 切会话瞬间会话根可能尚未挂载：只补一帧 rAF，不轮询；仍找不到就回退原生界面。
      if (!applied && typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(function () {
          try {
            applyNow();
          } catch (error) {
            warnWithCode('E_VARS', error);
          }
        });
      }
      return function () {
        if (frame) {
          try {
            cancelAnimationFrame(frame);
          } catch (error) {}
        }
        for (const root of writtenRoots) releaseAvatarVars(root, token);
        writtenRoots = [];
      };
    },
    [snapshot, workspaceId, sessionId]
  );
  const aiAvatarMode =
    snapshot && snapshot.data && snapshot.data.settings && snapshot.data.settings.aiAvatarMode === 'first-per-turn'
      ? 'first-per-turn'
      : 'every-step';
  // M3：会话内点击头像；M4-2：可选「每回合一次」增量标注（默认 every-step 时标注层不生效）。
  const SessionUtilities = React.Fragment || 'span';
  return h(
    SessionUtilities,
    null,
    h(AvatarInteraction, {
      sessionId: sessionId,
      workspaceId: workspaceId,
      snapshot: snapshot,
      conversationSnapshot: conversationSnapshot
    }),
    h(AvatarMarkLayer, {
      sessionId: sessionId,
      mode: aiAvatarMode,
      conversationSnapshot: conversationSnapshot
    })
  );
}
