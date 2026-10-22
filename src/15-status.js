/**
 * @module 15-status
 * 职责：诊断状态与错误码——只读状态对象、暂停原因、契约/版本探针结果、日志前缀。
 * 依赖：contract（包名/版本）。
 * 被依赖：storage / store / bridge / settings / apply。
 * 状态：M1-1 实现 warnWithCode 与诊断发布/清理的最小骨架（storage 子集）；
 *       版本/契约/暂停字段由 M1-5 补齐。
 */
const STATUS_GLOBAL_KEY = '__DSH_CHAT_AVATARS_STATUS__';

const ERROR_CODES = Object.freeze({
  STORAGE_UNAVAILABLE: 'E_STORAGE_UNAVAILABLE',
  STORAGE_QUOTA: 'E_STORAGE_QUOTA',
  BAD_DATA: 'E_BAD_DATA',
  MIGRATION: 'E_MIGRATION',
  NEWER_SCHEMA: 'E_NEWER_SCHEMA',
  CONTRACT: 'E_CONTRACT',
  VERSION_UNSUPPORTED: 'E_VERSION_UNSUPPORTED',
  TYPE: 'E_TYPE',
  SIZE: 'E_SIZE',
  DIMENSIONS: 'E_DIMENSIONS',
  TOO_LARGE: 'E_TOO_LARGE',
  DECODE: 'E_DECODE',
  ENCODE: 'E_ENCODE',
  ANIM_UNSUPPORTED: 'E_ANIM_UNSUPPORTED',
  IMPORT_INVALID: 'E_IMPORT_INVALID'
});

// 诊断快照只含非隐私字段（版本/契约/存储占用/暂停原因），由 store/apply 推送。
let statusFields = Object.freeze({});

/** 构造带 code 的 Error；调用方用 codeOf 取回。 */
function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** 取错误码；未知错误归为 E_GENERIC。 */
function codeOf(error) {
  if (error && typeof error.code === 'string') return error.code;
  return 'E_GENERIC';
}

/** 记录一条可定位的 warn；永不向宿主抛错（启动安全红线）。 */
function warnWithCode(code, error) {
  try {
    const detail = error && error.message ? ': ' + error.message : '';
    console.warn('[' + PACKAGE_NAME + '] ' + code + detail);
  } catch (ignored) {}
}

// @chat-avatars-status:start
/** 解析 semver（只处理 x.y.z[-pre]，足够版本门禁使用）；非法返回 null。 */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : []
  };
}

/** 比较两个 parseVersion 结果：-1/0/1（semver 预发布规则）。 */
function compareVersions(left, right) {
  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const length = Math.max(left.pre.length, right.pre.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.pre[index];
    const b = right.pre[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumber = /^\d+$/.test(a);
    const bNumber = /^\d+$/.test(b);
    if (aNumber && bNumber) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1;
    } else if (aNumber !== bNumber) {
      return aNumber ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/** 版本是否在支持区间内；未知/无法解析的版本不阻断（交给契约探针与横幅）。 */
function versionSupported(version) {
  const parsed = parseVersion(version);
  const lower = parseVersion(CONTRACT.minDsh);
  if (parsed === null) return true;
  if (lower === null) return true;
  // supportedRange = >=0.2.1-rc.2 <0.3.0：只接受同一 major/minor（0.2.x）。
  if (parsed.major !== lower.major || parsed.minor !== lower.minor) return false;
  if (parsed.patch < lower.patch) return false;
  if (parsed.patch === lower.patch) return compareVersions(parsed, lower) >= 0;
  return true;
}

/** 读取 window.__DSH_BOOT__.release；缺失/异常返回 null。 */
function readHostRelease() {
  try {
    if (typeof window === 'undefined' || !window) return null;
    const boot = window[CONTRACT.bootGlobal];
    const release = boot && boot.release;
    if (!release || typeof release.version !== 'string') return null;
    return {
      version: release.version,
      commit: typeof release.commit === 'string' ? release.commit : null
    };
  } catch (error) {
    return null;
  }
}

/** DOM 契约探针：ok / no-rows / missing / unknown。 */
function detectContract() {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') {
      return 'unknown';
    }
    const rows = document.querySelectorAll('[' + CONTRACT.attrs.flowKey + ']');
    if (!rows || typeof rows.length !== 'number' || rows.length === 0) {
      return document.querySelector('[' + CONTRACT.attrs.conversationSession + ']') ? 'no-rows' : 'unknown';
    }
    const kinds = document.querySelectorAll('[' + CONTRACT.attrs.flowKind + ']');
    return kinds && kinds.length > 0 ? 'ok' : 'missing';
  } catch (error) {
    return 'unknown';
  }
}

/** 组合版本/契约探针结果；override=true 时忽略契约暂停（用户「仍要尝试」）。 */
function evaluateStatusProbe(override) {
  const host = readHostRelease();
  const contract = detectContract();
  const version = host && host.version ? host.version : null;
  const supported = version ? versionSupported(version) : true;
  const tested = version ? CONTRACT.testedDsh.indexOf(version) >= 0 : false;
  const pauseReasons = [];
  if (contract === 'missing' && !override) pauseReasons.push(ERROR_CODES.CONTRACT);
  if (version && !supported) pauseReasons.push(ERROR_CODES.VERSION_UNSUPPORTED);
  return {
    host: host,
    contract: contract,
    versionStatus: !version ? 'unknown' : tested ? 'tested' : supported ? 'unverified' : 'unsupported',
    paused: pauseReasons.length > 0 ? pauseReasons[0] : null,
    pauseReasons: pauseReasons,
    checkedAt: Date.now()
  };
}
// @chat-avatars-status:end

/** 返回当前诊断快照（不含头像数据/会话内容）。 */
function createStatusSnapshot() {
  return Object.assign(
    {
      plugin: PACKAGE_NAME,
      build: CONTRACT.build,
      tested: CONTRACT.testedDsh.slice(),
      supportedRange: CONTRACT.supportedRange
    },
    statusFields
  );
}

/** 合并字段并发布到只读全局；window 不可用时只更新内存快照。 */
function publishStatus(patch) {
  try {
    if (patch && typeof patch === 'object') {
      statusFields = Object.freeze(Object.assign({}, statusFields, patch));
    }
    const snapshot = createStatusSnapshot();
    if (typeof window !== 'undefined') window[STATUS_GLOBAL_KEY] = snapshot;
    return snapshot;
  } catch (error) {
    warnWithCode('E_STATUS', error);
    return null;
  }
}

/** 清理诊断全局；插件禁用/卸载时由 apply 的 effect 清理调用。 */
function clearStatus() {
  statusFields = Object.freeze({});
  try {
    if (typeof window !== 'undefined') delete window[STATUS_GLOBAL_KEY];
  } catch (ignored) {}
}
