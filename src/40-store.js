/**
 * @module 40-store
 * 职责：内存状态 + 订阅通知；初始化/持久化提交/多标签刷新/数据工具/诊断投影；
 *       有效头像解析（工作区覆盖 → 全局默认 → 内置默认）由 M1-3 补。
 * 依赖：storage（数据）/ status（错误码、诊断发布）。
 * 被依赖：bridge / settings / interaction / apply。
 * 状态：M1 状态核心 + M5/M7 扩展（联合头像值、settings.poke/workspacesCollapsed）；不含 DOM。
 */
let storeState = null;
const storeSubscribers = new Set();

function getStoreState() {
  return storeState;
}

/** 订阅状态变化；返回取消订阅函数。 */
function subscribeStore(listener) {
  if (typeof listener !== 'function') return function () {};
  storeSubscribers.add(listener);
  return function () {
    storeSubscribers.delete(listener);
  };
}

function notifyStore() {
  const listeners = Array.from(storeSubscribers);
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      warnWithCode('E_STORE', error);
    }
  }
}

/** 诊断投影：只含非隐私字段，供 status 发布。 */
function storeDiagnostics() {
  const data = storeState ? storeState.data : null;
  return {
    host: storeState ? storeState.host : null,
    contract: storeState ? storeState.contract : 'unknown',
    versionStatus: storeState ? storeState.versionStatus : 'unknown',
    paused: storeState ? storeState.paused : null,
    pauseReasons: storeState ? storeState.pauseReasons.slice() : [],
    override: !!(storeState && storeState.override),
    storage: {
      available: storeState ? storeState.storageAvailable : false,
      readonly: storeState ? storeState.readonly : false,
      bytes: estimateBytes(data),
      schemaVersion: SCHEMA_VERSION,
      lastWriteError: storeState ? storeState.lastWriteError : null,
      warnings: storeState ? storeState.warnings.slice() : []
    },
    checkedAt: Date.now()
  };
}

function setStoreState(patch) {
  if (storeState === null) return;
  storeState = Object.assign({}, storeState, patch);
  publishStatus(storeDiagnostics());
  notifyStore();
}

/** 首次初始化（读 localStorage + 校验 + 诊断发布）；失败由 apply 兜底。 */
function initStore() {
  if (storeState !== null) return storeState;
  const loaded = loadStoreState();
  storeState = {
    data: loaded.data,
    readonly: loaded.readonly,
    warnings: loaded.warnings,
    storageAvailable: loaded.storageAvailable,
    lastWriteError: null,
    host: null,
    contract: 'unknown',
    versionStatus: 'unknown',
    paused: null,
    pauseReasons: [],
    currentWorkspaceId: null,
    override: false,
    probeNonce: 0,
    probeCheckedAt: 0
  };
  publishStatus(storeDiagnostics());
  return storeState;
}

/** 多标签/外部变更后重新读取 localStorage（last-write-wins）并通知订阅者。 */
function reloadStore() {
  if (storeState === null) return initStore();
  const loaded = loadStoreState();
  setStoreState({
    data: loaded.data,
    readonly: loaded.readonly,
    warnings: loaded.warnings,
    storageAvailable: loaded.storageAvailable
  });
  return storeState;
}

/** 事务式提交：深拷贝 → mutator → 重新校验 → 写盘成功后才提交内存并通知。 */
function commitStore(mutator) {
  if (storeState === null) return { ok: false, code: ERROR_CODES.STORAGE_UNAVAILABLE };
  if (storeState.readonly) return { ok: false, code: ERROR_CODES.NEWER_SCHEMA };
  let nextData = null;
  try {
    nextData = JSON.parse(JSON.stringify(storeState.data));
    mutator(nextData);
  } catch (error) {
    return { ok: false, code: ERROR_CODES.BAD_DATA };
  }
  nextData.schemaVersion = SCHEMA_VERSION;
  nextData.pluginVersion = CONTRACT.build;
  nextData.updatedAt = isoNow();
  const sanitized = sanitizeData(nextData);
  const persisted = persistStoreData(sanitized.data);
  if (!persisted.ok && persisted.code === ERROR_CODES.STORAGE_UNAVAILABLE) {
    // 隐私模式/存储不可用：降级为内存模式，修改刷新前有效。
    setStoreState({
      data: sanitized.data,
      warnings: sanitized.warnings,
      lastWriteError: persisted.code,
      storageAvailable: false
    });
    return { ok: true, memoryOnly: true };
  }
  if (!persisted.ok) {
    // 配额满：不提交内存，保留上一份一致状态并暴露错误码。
    setStoreState({ lastWriteError: persisted.code });
    return persisted;
  }
  setStoreState({
    data: sanitized.data,
    warnings: sanitized.warnings,
    lastWriteError: null,
    storageAvailable: true
  });
  return { ok: true };
}

function setStoreSettings(patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, code: ERROR_CODES.BAD_DATA };
  return commitStore(function (data) {
    if ('enabled' in patch) data.settings.enabled = !!patch.enabled;
    if ('showUser' in patch) data.settings.showUser = !!patch.showUser;
    if ('showAssistant' in patch) data.settings.showAssistant = !!patch.showAssistant;
    if ('size' in patch && validAvatarSize(patch.size)) data.settings.size = patch.size;
    if ('shape' in patch) data.settings.shape = patch.shape === 'rounded' ? 'rounded' : 'circle';
    if ('aiAvatarMode' in patch && AI_AVATAR_MODES.indexOf(patch.aiAvatarMode) >= 0) {
      data.settings.aiAvatarMode = patch.aiAvatarMode;
    }
    // M7 打磨：工作区卡折叠状态（UI 偏好，持久化到数据）。
    if ('workspacesCollapsed' in patch) data.settings.workspacesCollapsed = !!patch.workspacesCollapsed;
    // M7：拍一拍设置整对象提交（页面持当前值，逐字段校验后合并）。
    if ('poke' in patch && patch.poke && typeof patch.poke === 'object' && !Array.isArray(patch.poke)) {
      const current = data.settings.poke && typeof data.settings.poke === 'object' ? data.settings.poke : {};
      const merged = Object.assign({}, current);
      if ('enabled' in patch.poke) merged.enabled = !!patch.poke.enabled;
      if ('sound' in patch.poke) merged.sound = !!patch.poke.sound;
      if ('volume' in patch.poke) {
        const volume = Number(patch.poke.volume);
        if (Number.isInteger(volume) && volume >= 0 && volume <= 100) merged.volume = volume;
      }
      if ('userText' in patch.poke) {
        merged.userText = typeof sanitizePokeText === 'function' ? sanitizePokeText(patch.poke.userText) : '';
      }
      if ('assistantText' in patch.poke) {
        merged.assistantText = typeof sanitizePokeText === 'function' ? sanitizePokeText(patch.poke.assistantText) : '';
      }
      if ('userTexts' in patch.poke) {
        merged.userTexts =
          typeof sanitizePokeTexts === 'function'
            ? sanitizePokeTexts(patch.poke.userTexts, merged.userText)
            : Array.isArray(patch.poke.userTexts) ? patch.poke.userTexts.slice(0, 8) : [];
      }
      if ('assistantTexts' in patch.poke) {
        merged.assistantTexts =
          typeof sanitizePokeTexts === 'function'
            ? sanitizePokeTexts(patch.poke.assistantTexts, merged.assistantText)
            : Array.isArray(patch.poke.assistantTexts) ? patch.poke.assistantTexts.slice(0, 8) : [];
      }
      data.settings.poke = merged;
    }
  });
}

/** scope 为 'global' 或 { workspaceId }；value 为合法头像值（静态 data URL / 动图对象）或 null。 */
function setStoreAvatar(scope, side, value) {
  if (SIDES.indexOf(side) < 0) return { ok: false, code: ERROR_CODES.BAD_DATA };
  if (value !== null && !validAvatar(value)) return { ok: false, code: ERROR_CODES.BAD_DATA };
  const isGlobal = scope === 'global';
  const workspaceId = !isGlobal && scope ? scope.workspaceId : undefined;
  if (!isGlobal && (workspaceId === undefined || workspaceId === null)) {
    return { ok: false, code: ERROR_CODES.BAD_DATA };
  }
  return commitStore(function (data) {
    if (isGlobal) {
      data.global[side] = value;
      return;
    }
    const key = String(workspaceId);
    const current = data.workspaces[key] || { user: null, assistant: null };
    current[side] = value;
    if (!current.user && !current.assistant) delete data.workspaces[key];
    else data.workspaces[key] = current;
  });
}

/**
 * 滑块高频预览路径：只更新内存中的 settings.size 并通知订阅者（bridge/settings 即时刷新），
 * 不写 localStorage、不重算诊断字节数；落盘由设置页 200ms 合并后 setStoreSettings 完成。
 */
function previewStoreSize(size) {
  if (storeState === null) return { ok: false, code: ERROR_CODES.STORAGE_UNAVAILABLE };
  if (storeState.readonly) return { ok: false, code: ERROR_CODES.NEWER_SCHEMA };
  if (!validAvatarSize(size)) return { ok: false, code: ERROR_CODES.BAD_DATA };
  if (!storeState.data || !storeState.data.settings) return { ok: false, code: ERROR_CODES.BAD_DATA };
  if (storeState.data.settings.size === size) return { ok: true, preview: true };
  const nextData = Object.assign({}, storeState.data, {
    settings: Object.assign({}, storeState.data.settings, { size: size })
  });
  // 有意不调用 publishStatus：避免每次拖动都对整份数据做 JSON.stringify 统计。
  storeState = Object.assign({}, storeState, { data: nextData });
  notifyStore();
  return { ok: true, preview: true };
}

function clearStoreWorkspace(workspaceId) {
  if (workspaceId === undefined || workspaceId === null) {
    return { ok: false, code: ERROR_CODES.BAD_DATA };
  }
  return commitStore(function (data) {
    delete data.workspaces[String(workspaceId)];
  });
}

function clearAllStoreData() {
  return commitStore(function (data) {
    data.settings = {
      enabled: DEFAULT_SETTINGS.enabled,
      size: DEFAULT_SETTINGS.size,
      shape: DEFAULT_SETTINGS.shape,
      showUser: DEFAULT_SETTINGS.showUser,
      showAssistant: DEFAULT_SETTINGS.showAssistant,
      aiAvatarMode: DEFAULT_SETTINGS.aiAvatarMode
    };
    data.global = { user: null, assistant: null };
    data.workspaces = {};
  });
}

function removeOrphanStoreWorkspaces(validIds) {
  const keep = new Set((validIds || []).map(String));
  return commitStore(function (data) {
    for (const key of Object.keys(data.workspaces)) {
      if (!keep.has(key)) delete data.workspaces[key];
    }
  });
}

/** 导入确认后整份替换（不提供半合并状态）。 */
function replaceAllStoreData(sourceData) {
  const sanitized = sanitizeData(sourceData);
  return commitStore(function (data) {
    data.settings = sanitized.data.settings;
    data.global = sanitized.data.global;
    data.workspaces = sanitized.data.workspaces;
  });
}

function buildStoreExport() {
  return buildExportPayload(storeState ? storeState.data : null);
}

function parseStoreImport(text) {
  return parseImportPayload(text);
}

// @chat-avatars-store:start
/**
 * 纯函数：工作区覆盖 → 全局默认 → 内置默认；enabled 关闭时返回 { enabled: false }。
 * 每侧返回 { show, image, animated: { frames, frameMs } | null, label }：
 * - 静态头像：image 为 data URL，animated=null；
 * - 动图头像：image 为雪碧图 data URL，animated 携带帧数/帧时长（渲染层用）。
 */
function resolveEffectiveAvatar(data, workspaceId) {
  const source = data && typeof data === 'object' ? data : null;
  const settings = source && source.settings ? source.settings : DEFAULT_SETTINGS;
  if (!settings.enabled) return { enabled: false };
  const entry =
    source && workspaceId !== null && workspaceId !== undefined && source.workspaces
      ? source.workspaces[String(workspaceId)] || null
      : null;
  const result = { enabled: true, size: settings.size, shape: settings.shape, user: null, assistant: null };
  for (const side of SIDES) {
    const show = side === 'user' ? settings.showUser : settings.showAssistant;
    let value = null;
    if (entry && validAvatar(entry[side])) value = entry[side];
    else if (source && source.global && validAvatar(source.global[side])) value = source.global[side];
    const animated = value && typeof value === 'object' ? { frames: value.frames, frameMs: value.frameMs } : null;
    const image = value === null ? null : typeof value === 'string' ? value : value.src;
    result[side] = {
      show: !!show,
      image: image,
      animated: animated,
      label: image ? '' : side === 'user' ? t('default.user') : t('default.assistant')
    };
  }
  return result;
}

/** 写入版本/契约探针结果（apply 调用；暂停态由桥消费）。 */
function applyProbeResult(result) {
  if (storeState === null || !result) return;
  setStoreState({
    host: result.host || null,
    contract: result.contract || 'unknown',
    versionStatus: result.versionStatus || 'unknown',
    paused: result.paused || null,
    pauseReasons: Array.isArray(result.pauseReasons) ? result.pauseReasons.slice() : [],
    probeCheckedAt: result.checkedAt || Date.now()
  });
}

/** 用户「仍要尝试」/「恢复自动检测」；apply 订阅 override 变化后重新探针。 */
function setOverride(value) {
  if (storeState === null) return;
  const next = !!value;
  if (storeState.override === next) return;
  setStoreState({ override: next });
}

/** 手动「重新检测」：递增 nonce 触发 apply 重新探针。 */
function requestProbe() {
  if (storeState === null) return;
  setStoreState({ probeNonce: (storeState.probeNonce || 0) + 1 });
}

/** 当前会话所属工作区（设置页即时预览/桥共用；M1-4 起由设置页读取）。 */
function setCurrentWorkspace(workspaceId) {
  if (storeState === null) return;
  const value = workspaceId === undefined ? null : workspaceId;
  if (storeState.currentWorkspaceId === value) return;
  setStoreState({ currentWorkspaceId: value });
}
// @chat-avatars-store:end

/** apply 使用的 store 门面；bridge/settings 可直接复用同闭包函数。 */
function createStore() {
  return Object.freeze({
    init: initStore,
    getState: getStoreState,
    subscribe: subscribeStore,
    reload: reloadStore,
    commit: commitStore,
    diagnostics: storeDiagnostics,
    setSettings: setStoreSettings,
    previewSize: previewStoreSize,
    setAvatar: setStoreAvatar,
    clearWorkspace: clearStoreWorkspace,
    clearAllData: clearAllStoreData,
    removeOrphanWorkspaces: removeOrphanStoreWorkspaces,
    replaceAllData: replaceAllStoreData,
    buildExport: buildStoreExport,
    parseImport: parseStoreImport,
    setCurrentWorkspace: setCurrentWorkspace,
    applyProbeResult: applyProbeResult,
    setOverride: setOverride,
    requestProbe: requestProbe
  });
}
