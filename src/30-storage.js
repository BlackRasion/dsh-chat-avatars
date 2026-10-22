/**
 * @module 30-storage
 * 职责：localStorage 单 key 数据模型——默认值/校验/迁移/读写/损坏备份/配额/导出导入。
 * 依赖：contract（版本号）、status（错误码/日志）。
 * 被依赖：store / settings / apply。
 * 状态：M1-1 迁移 0.1.0 已验证实现；M5 升级 schema v2（静态字符串 + 动图对象联合类型）。
 *
 * 可测试性：`@chat-avatars-storage:start/end` 之间只含纯函数与 window.localStorage 读写，
 * test/storage.test.mjs 用零依赖源码提取 + localStorage stub 覆盖坏数据/未知 schema/配额/导入往返。
 */
// @chat-avatars-storage:start
const STORAGE_KEY = 'dsh.chat-avatars.v1';
const STORAGE_BROKEN_KEY = STORAGE_KEY + '.broken';
// 注意：STORAGE_KEY 后缀是历史命名（M1 定稿），schema 版本以 JSON 内 schemaVersion 为准。
const SCHEMA_VERSION = 2;
const SIDES = Object.freeze(['user', 'assistant']);
// M5-5：尺寸从枚举改为 24–60px 连续区间（滑块 step 1）；旧值全部合法，schema v2 不变。
const SIZE_MIN = 24;
const SIZE_MAX = 60;
const AI_AVATAR_MODES = Object.freeze(['every-step', 'first-per-turn']);
// 静态头像 data URL 上限（256×256 WebP 质量阶梯处理，约 90KB binary）。
const STATIC_MAX_DATA_URL_CHARS = 120000;
// 动图雪碧图 data URL 上限（横向 256×frames，约 144KB binary）。
const ANIM_MAX_DATA_URL_CHARS = 192000;
// validAvatar 接受的动图帧数/帧时长区间；上传管线自适应目标 8–96 帧（见 51-animation）。
const ANIM_VALUE_FRAME_MIN = 2;
const ANIM_VALUE_FRAME_MAX = 96;
const ANIM_FRAME_MS_MIN = 20;
const ANIM_FRAME_MS_MAX = 5000;
const WARN_STORAGE_BYTES = 3 * 1024 * 1024;
const DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const EXPORT_FORMAT = 'dsh-chat-avatars';
// M7：拍一拍文案上限（字符）；超长截断、控制字符替换为空格。
const POKE_TEXT_MAX = 40;
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  size: 32,
  shape: 'circle',
  showUser: true,
  showAssistant: true,
  aiAvatarMode: 'every-step',
  // M7 打磨：工作区覆盖卡默认折叠（UI 偏好，随数据持久化/导出导入/多标签同步）。
  workspacesCollapsed: true,
  // M7：纯本地拍一拍；文案空串 = 使用 i18n 默认文案（跟随语言）。
  poke: Object.freeze({
    enabled: true,
    sound: true,
    volume: 60,
    userText: '',
    assistantText: ''
  })
});

/** schema 迁移表：MIGRATIONS[2] 把 v1 数据升到 v2（静态头像字符串原样保留，动图对象本就没有 v1 数据）。 */
const MIGRATIONS = Object.freeze({
  2: function migrateV1ToV2(data) {
    return Object.assign({}, data, { schemaVersion: 2 });
  }
});

function isoNow() {
  try {
    return new Date().toISOString();
  } catch (error) {
    return null;
  }
}

function dedupe(list) {
  const out = [];
  for (const item of list) if (out.indexOf(item) < 0) out.push(item);
  return out;
}

/** 尺寸合法性：24–60 的整数（滑块 step 1）；非法值回落默认 32。 */
function validAvatarSize(value) {
  return Number.isInteger(value) && value >= SIZE_MIN && value <= SIZE_MAX;
}

/** 音量合法性：0–100 整数。 */
function validPokeVolume(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/** 拍一拍文案归一化：去控制字符、压缩空白、trim、截断 POKE_TEXT_MAX；非字符串 -> ''。 */
function sanitizePokeText(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > POKE_TEXT_MAX ? cleaned.slice(0, POKE_TEXT_MAX) : cleaned;
}

function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    pluginVersion: CONTRACT.build,
    settings: {
      enabled: DEFAULT_SETTINGS.enabled,
      size: DEFAULT_SETTINGS.size,
      shape: DEFAULT_SETTINGS.shape,
      showUser: DEFAULT_SETTINGS.showUser,
      showAssistant: DEFAULT_SETTINGS.showAssistant,
      aiAvatarMode: DEFAULT_SETTINGS.aiAvatarMode,
      workspacesCollapsed: DEFAULT_SETTINGS.workspacesCollapsed,
      poke: {
        enabled: DEFAULT_SETTINGS.poke.enabled,
        sound: DEFAULT_SETTINGS.poke.sound,
        volume: DEFAULT_SETTINGS.poke.volume,
        userText: DEFAULT_SETTINGS.poke.userText,
        assistantText: DEFAULT_SETTINGS.poke.assistantText
      }
    },
    global: { user: null, assistant: null },
    workspaces: {},
    updatedAt: isoNow()
  };
}

/** data URL 白名单 + 字符数上限（静态/雪碧图共用）。 */
function validDataUrl(value, maxChars) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxChars &&
    DATA_URL_RE.test(value)
  );
}

/** 静态头像值：PNG/JPEG/WebP data URL 且 ≤ STATIC_MAX_DATA_URL_CHARS。 */
function validImage(value) {
  return validDataUrl(value, STATIC_MAX_DATA_URL_CHARS);
}

function isAnimatedAvatar(value) {
  return !!value && typeof value === 'object' && value.kind === 'animated';
}

/** 校验并归一化单个头像值：静态返回字符串；动图返回白名单字段对象；非法返回 null。 */
function normalizeAvatar(value) {
  if (typeof value === 'string') return validImage(value) ? value : null;
  if (!isAnimatedAvatar(value)) return null;
  if (value.v !== 1) return null;
  if (!validDataUrl(value.src, ANIM_MAX_DATA_URL_CHARS)) return null;
  if (
    !Number.isInteger(value.frames) ||
    value.frames < ANIM_VALUE_FRAME_MIN ||
    value.frames > ANIM_VALUE_FRAME_MAX
  ) {
    return null;
  }
  if (
    !Number.isInteger(value.frameMs) ||
    value.frameMs < ANIM_FRAME_MS_MIN ||
    value.frameMs > ANIM_FRAME_MS_MAX
  ) {
    return null;
  }
  // 只保留白名单字段，未知字段不进入持久化数据。
  return { kind: 'animated', v: 1, src: value.src, frames: value.frames, frameMs: value.frameMs };
}

/** 合法头像值判定：静态 data URL 或 schema v2 动图对象。 */
function validAvatar(value) {
  return value !== null && value !== undefined && normalizeAvatar(value) !== null;
}

/** 校验并归一化任意输入（读取/导入/提交共用）；非法层跳过并记 code，不抛错。 */
function sanitizeData(input) {
  const warnings = [];
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const data = defaultData();
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  data.settings.enabled = settings.enabled === undefined ? DEFAULT_SETTINGS.enabled : !!settings.enabled;
  data.settings.showUser = settings.showUser === undefined ? DEFAULT_SETTINGS.showUser : !!settings.showUser;
  data.settings.showAssistant =
    settings.showAssistant === undefined ? DEFAULT_SETTINGS.showAssistant : !!settings.showAssistant;
  data.settings.size = validAvatarSize(settings.size) ? settings.size : DEFAULT_SETTINGS.size;
  data.settings.shape = settings.shape === 'rounded' ? 'rounded' : 'circle';
  data.settings.aiAvatarMode =
    AI_AVATAR_MODES.indexOf(settings.aiAvatarMode) >= 0 ? settings.aiAvatarMode : DEFAULT_SETTINGS.aiAvatarMode;
  data.settings.workspacesCollapsed =
    settings.workspacesCollapsed === undefined ? DEFAULT_SETTINGS.workspacesCollapsed : !!settings.workspacesCollapsed;
  // M7：拍一拍设置逐字段回落默认（缺省/非法都不影响其它设置）。
  const poke = settings.poke && typeof settings.poke === 'object' && !Array.isArray(settings.poke) ? settings.poke : {};
  data.settings.poke.enabled = poke.enabled === undefined ? DEFAULT_SETTINGS.poke.enabled : !!poke.enabled;
  data.settings.poke.sound = poke.sound === undefined ? DEFAULT_SETTINGS.poke.sound : !!poke.sound;
  data.settings.poke.volume = validPokeVolume(poke.volume) ? poke.volume : DEFAULT_SETTINGS.poke.volume;
  data.settings.poke.userText = sanitizePokeText(poke.userText);
  data.settings.poke.assistantText = sanitizePokeText(poke.assistantText);
  const global = source.global && typeof source.global === 'object' ? source.global : {};
  for (const side of SIDES) {
    const value = global[side];
    if (value === null || value === undefined) continue;
    const avatar = normalizeAvatar(value);
    if (avatar !== null) data.global[side] = avatar;
    else warnings.push(ERROR_CODES.BAD_DATA);
  }
  const workspaces =
    source.workspaces && typeof source.workspaces === 'object' && !Array.isArray(source.workspaces)
      ? source.workspaces
      : {};
  for (const rawKey of Object.keys(workspaces)) {
    // 防原型污染：JSON 里的 "__proto__" 键不能直接赋值到普通对象上。
    if (rawKey === '__proto__') {
      warnings.push(ERROR_CODES.BAD_DATA);
      continue;
    }
    const entry = workspaces[rawKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(ERROR_CODES.BAD_DATA);
      continue;
    }
    const clean = { user: null, assistant: null };
    for (const side of SIDES) {
      const value = entry[side];
      if (value === null || value === undefined) continue;
      const avatar = normalizeAvatar(value);
      if (avatar !== null) clean[side] = avatar;
      else warnings.push(ERROR_CODES.BAD_DATA);
    }
    if (clean.user === null && clean.assistant === null) continue;
    data.workspaces[String(rawKey)] = clean;
  }
  if (typeof source.updatedAt === 'string') data.updatedAt = source.updatedAt;
  return { data: data, warnings: dedupe(warnings) };
}

/** 顺序执行已注册迁移；缺迁移函数或版本非法时抛 E_MIGRATION（由 loadStoreState 兜底）。 */
function migrateData(input) {
  let data = input;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (!Number.isInteger(version) || version < 1) throw makeError(ERROR_CODES.MIGRATION);
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version + 1];
    if (typeof migrate !== 'function') throw makeError(ERROR_CODES.MIGRATION);
    data = migrate(data);
    version = typeof data.schemaVersion === 'number' ? data.schemaVersion : version + 1;
  }
  return data;
}

/** 损坏/迁移前原值备份；只写一次，避免后续坏写覆盖第一次证据。 */
function backupRaw(raw) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (window.localStorage.getItem(STORAGE_BROKEN_KEY) !== null) return;
    window.localStorage.setItem(STORAGE_BROKEN_KEY, String(raw));
  } catch (error) {}
}

function readStorageRaw() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ok: false, value: null };
    return { ok: true, value: window.localStorage.getItem(STORAGE_KEY) };
  } catch (error) {
    return { ok: false, value: null };
  }
}

/** 读取并校验；永不抛错。返回 { data, readonly, warnings, storageAvailable }。 */
function loadStoreState() {
  const result = { data: defaultData(), readonly: false, warnings: [], storageAvailable: true };
  const raw = readStorageRaw();
  if (!raw.ok) {
    result.storageAvailable = false;
    result.warnings.push(ERROR_CODES.STORAGE_UNAVAILABLE);
    return result;
  }
  if (!raw.value) return result;
  let parsed = null;
  try {
    parsed = JSON.parse(raw.value);
  } catch (error) {
    backupRaw(raw.value);
    result.warnings.push(ERROR_CODES.BAD_DATA);
    return result;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    backupRaw(raw.value);
    result.warnings.push(ERROR_CODES.BAD_DATA);
    return result;
  }
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
  if (version > SCHEMA_VERSION) {
    // 更新版本的数据：只读展示，不覆盖、不迁移、不写坏。
    result.readonly = true;
    result.warnings.push(ERROR_CODES.NEWER_SCHEMA);
    result.data = sanitizeData(parsed).data;
    return result;
  }
  // v1 数据迁移前先备份原始值，再只升版本号（静态头像字符串原样保留）。
  if (version < SCHEMA_VERSION) backupRaw(raw.value);
  let migrated = null;
  try {
    migrated = migrateData(parsed);
  } catch (error) {
    backupRaw(raw.value);
    result.warnings.push(ERROR_CODES.MIGRATION);
    return result;
  }
  const sanitized = sanitizeData(migrated);
  result.data = sanitized.data;
  result.warnings = result.warnings.concat(sanitized.warnings);
  return result;
}

/** 写入 localStorage；配额/不可用返回结构化 code，由调用方决定是否提交内存。 */
function persistStoreData(data) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ok: false, code: ERROR_CODES.STORAGE_UNAVAILABLE };
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    const quota =
      error &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22 ||
        error.code === 1014);
    return { ok: false, code: quota ? ERROR_CODES.STORAGE_QUOTA : ERROR_CODES.STORAGE_UNAVAILABLE };
  }
}

function estimateBytes(data) {
  try {
    return data ? JSON.stringify(data).length : 0;
  } catch (error) {
    return 0;
  }
}

/** 统计动图头像数量（诊断/导出提示用；不包含头像数据本体）。 */
function countAnimatedAvatars(data) {
  try {
    const source = data && typeof data === 'object' ? data : {};
    let count = 0;
    const global = source.global || {};
    for (const side of SIDES) if (isAnimatedAvatar(global[side])) count += 1;
    const workspaces = source.workspaces || {};
    for (const key of Object.keys(workspaces)) {
      const entry = workspaces[key] || {};
      for (const side of SIDES) if (isAnimatedAvatar(entry[side])) count += 1;
    }
    return count;
  } catch (error) {
    return 0;
  }
}

/** 生成导出 JSON（不写盘/不下载，下载动作在设置页 M1-4）。 */
function buildExportPayload(data) {
  const source = data && typeof data === 'object' ? data : defaultData();
  return {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    pluginVersion: CONTRACT.build,
    exportedAt: isoNow(),
    data: JSON.parse(JSON.stringify(source))
  };
}

/** 解析/校验导入 JSON；不合法抛带 code 的错误，绝不部分写入。仅接受 schemaVersion 2。 */
function parseImportPayload(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw makeError(ERROR_CODES.IMPORT_INVALID);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.format !== EXPORT_FORMAT) {
    throw makeError(ERROR_CODES.IMPORT_INVALID);
  }
  // 用户已确认：不做 v1 导出备份兼容；只接受当前 schema 版本。
  if (parsed.schemaVersion !== SCHEMA_VERSION) throw makeError(ERROR_CODES.IMPORT_INVALID);
  // 导出格式固定带 data 对象；缺 data/类型不符直接拒绝，避免“空导入成功”的假象。
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw makeError(ERROR_CODES.IMPORT_INVALID);
  }
  const sanitized = sanitizeData(parsed.data);
  let images = 0;
  if (sanitized.data.global.user) images += 1;
  if (sanitized.data.global.assistant) images += 1;
  for (const key of Object.keys(sanitized.data.workspaces)) {
    const entry = sanitized.data.workspaces[key];
    if (entry.user) images += 1;
    if (entry.assistant) images += 1;
  }
  return {
    data: sanitized.data,
    images: images,
    animated: countAnimatedAvatars(sanitized.data),
    workspaces: Object.keys(sanitized.data.workspaces).length,
    warnings: sanitized.warnings
  };
}
// @chat-avatars-storage:end
