// M1-1/M5 存储层零依赖测试：从 src/30-storage.js 的源码标记区提取纯函数/存储函数，
// 用 localStorage stub 覆盖坏数据、未知 schema、迁移失败、配额、存储不可用、导出/导入往返，
// 以及 schema v2 的静态/动图联合头像值（validAvatar/normalizeAvatar）与 v1→v2 迁移。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/30-storage.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-storage:start';
const END = '// @chat-avatars-storage:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/30-storage.js 缺少 @chat-avatars-storage 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({ build: '0.1.0' });
const ERROR_CODES = Object.freeze({
  STORAGE_UNAVAILABLE: 'E_STORAGE_UNAVAILABLE',
  STORAGE_QUOTA: 'E_STORAGE_QUOTA',
  BAD_DATA: 'E_BAD_DATA',
  MIGRATION: 'E_MIGRATION',
  NEWER_SCHEMA: 'E_NEWER_SCHEMA',
  IMPORT_INVALID: 'E_IMPORT_INVALID'
});
function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** 用源码标记区构造一个隔离的“存储模块”实例（每次调用重置 globalThis.window）。 */
function loadStorage(localStorageImpl) {
  globalThis.window = { localStorage: localStorageImpl };
  const exportsLine =
    'return { STORAGE_KEY, STORAGE_BROKEN_KEY, SCHEMA_VERSION, SIDES, SIZE_MIN, SIZE_MAX, validAvatarSize,' +
    ' STATIC_MAX_DATA_URL_CHARS, ANIM_MAX_DATA_URL_CHARS, ANIM_VALUE_FRAME_MIN, ANIM_VALUE_FRAME_MAX,' +
    ' ANIM_FRAME_MS_MIN, ANIM_FRAME_MS_MAX, WARN_STORAGE_BYTES, DATA_URL_RE, DEFAULT_SETTINGS,' +
    ' AI_AVATAR_MODES, MIGRATIONS, defaultData, validDataUrl, validImage, validAvatar, isAnimatedAvatar,' +
    ' normalizeAvatar, sanitizeData, migrateData, loadStoreState, persistStoreData, estimateBytes,' +
    ' countAnimatedAvatars, buildExportPayload, parseImportPayload };';
  const factory = new Function('CONTRACT', 'ERROR_CODES', 'makeError', 'warnWithCode', "'use strict';\n" + BLOCK + '\n' + exportsLine);
  return factory(CONTRACT, ERROR_CODES, makeError, function () {});
}

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

const PNG = 'data:image/png;base64,AAAA';
const WEBP = 'data:image/webp;base64,BBBB';
const JPEG = 'data:image/jpeg;base64,CCCC';
const SPRITE = 'data:image/webp;base64,SPRITE';
const ANIM = { kind: 'animated', v: 1, src: SPRITE, frames: 8, frameMs: 56 };
const KEY = 'dsh.chat-avatars.v1';
const BROKEN_KEY = KEY + '.broken';

test('默认数据与常量符合 schema v2', () => {
  const s = loadStorage(memoryStorage());
  const data = s.defaultData();
  assert.equal(s.SCHEMA_VERSION, 2);
  assert.equal(s.STORAGE_KEY, KEY);
  assert.equal(s.STORAGE_BROKEN_KEY, BROKEN_KEY);
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.pluginVersion, '0.1.0');
  assert.deepEqual(data.settings, { enabled: true, size: 32, shape: 'circle', showUser: true, showAssistant: true, aiAvatarMode: 'every-step', workspacesCollapsed: true, poke: { enabled: true, sound: true, volume: 60, userText: '', assistantText: '' } });
  assert.deepEqual(data.global, { user: null, assistant: null });
  assert.deepEqual(data.workspaces, {});
  assert.equal(s.STATIC_MAX_DATA_URL_CHARS, 120000);
  assert.equal(s.ANIM_MAX_DATA_URL_CHARS, 192000);
  assert.equal(s.SIZE_MIN, 24);
  assert.equal(s.SIZE_MAX, 60);
  assert.equal(s.ANIM_VALUE_FRAME_MIN, 2);
  assert.equal(s.ANIM_VALUE_FRAME_MAX, 96);
  assert.equal(s.ANIM_FRAME_MS_MIN, 20);
  assert.equal(s.ANIM_FRAME_MS_MAX, 5000);
});

test('尺寸校验改为 24–60 整数区间（滑块 step 1）', () => {
  const s = loadStorage(memoryStorage());
  assert.equal(s.validAvatarSize(24), true);
  assert.equal(s.validAvatarSize(60), true);
  assert.equal(s.validAvatarSize(32), true);
  assert.equal(s.validAvatarSize(23), false);
  assert.equal(s.validAvatarSize(61), false);
  assert.equal(s.validAvatarSize(33.5), false);
  assert.equal(s.validAvatarSize('32'), false);
  assert.equal(s.sanitizeData({ settings: { size: 24 } }).data.settings.size, 24);
  assert.equal(s.sanitizeData({ settings: { size: 60 } }).data.settings.size, 60);
  assert.equal(s.sanitizeData({ settings: { size: 23 } }).data.settings.size, 32);
  assert.equal(s.sanitizeData({ settings: { size: 61 } }).data.settings.size, 32);
  assert.equal(s.sanitizeData({ settings: { size: 33.5 } }).data.settings.size, 32);
});

test('静态头像白名单只接受 png/jpeg/webp data URL 且限长', () => {
  const s = loadStorage(memoryStorage());
  assert.equal(s.validImage(PNG), true);
  assert.equal(s.validImage(JPEG), true);
  assert.equal(s.validImage(WEBP), true);
  assert.equal(s.validImage('javascript:alert(1)'), false);
  assert.equal(s.validImage('https://example.com/a.png'), false);
  assert.equal(s.validImage('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(s.validImage('data:image/png;base64,'), false);
  assert.equal(s.validImage('data:image/webp;base64,' + 'A'.repeat(s.STATIC_MAX_DATA_URL_CHARS)), false);
  assert.equal(s.validDataUrl(WEBP, 10), false);
  assert.equal(s.validDataUrl(WEBP, 1000), true);
});

test('动图值 validAvatar：合法对象通过，字段/边界非法逐项拒绝', () => {
  const s = loadStorage(memoryStorage());
  assert.equal(s.validAvatar(ANIM), true);
  assert.equal(s.validAvatar(Object.assign({}, ANIM, { extra: 'dropped' })), true);
  assert.deepEqual(s.normalizeAvatar(Object.assign({}, ANIM, { extra: 'dropped' })), ANIM);
  assert.equal(s.validAvatar(null), false);
  assert.equal(s.validAvatar(undefined), false);
  assert.equal(s.validAvatar(PNG), true);
  const invalid = [
    Object.assign({}, ANIM, { kind: 'static' }),
    Object.assign({}, ANIM, { v: 2 }),
    Object.assign({}, ANIM, { v: '1' }),
    Object.assign({}, ANIM, { src: 'https://evil/a.webp' }),
    Object.assign({}, ANIM, { src: 'data:image/webp;base64,' + 'A'.repeat(s.ANIM_MAX_DATA_URL_CHARS) }),
    Object.assign({}, ANIM, { frames: 1 }),
    Object.assign({}, ANIM, { frames: 97 }),
    Object.assign({}, ANIM, { frames: 2.5 }),
    Object.assign({}, ANIM, { frameMs: 0 }),
    Object.assign({}, ANIM, { frameMs: 6000 }),
    Object.assign({}, ANIM, { frameMs: 20.5 }),
    { kind: 'animated', v: 1, src: SPRITE, frames: 8 },
    { src: SPRITE, frames: 8, frameMs: 56 }
  ];
  for (const value of invalid) {
    assert.equal(s.validAvatar(value), false, '应拒绝: ' + JSON.stringify(value));
    assert.equal(s.normalizeAvatar(value), null);
  }
  assert.equal(s.validAvatar(Object.assign({}, ANIM, { frames: 2, frameMs: 20 })), true);
  assert.equal(s.validAvatar(Object.assign({}, ANIM, { frames: 24, frameMs: 5000 })), true);
  assert.equal(s.validAvatar(Object.assign({}, ANIM, { frames: 96 })), true);
  assert.equal(s.validAvatar(Object.assign({}, ANIM, { frames: 97 })), false);
});

test('sanitizeData 归一化设置、跳过非法层并报告 E_BAD_DATA（含动图联合类型）', () => {
  const s = loadStorage(memoryStorage());
  const result = s.sanitizeData({
    settings: { enabled: false, size: 999, shape: 'weird', aiAvatarMode: 'first-per-turn' },
    global: { user: 'javascript:alert(1)', assistant: ANIM },
    workspaces: {
      ws1: { user: PNG, assistant: Object.assign({}, ANIM, { frames: 99 }) },
      ws2: { user: null, assistant: null },
      ws3: 'not-an-entry'
    }
  });
  assert.equal(result.data.settings.enabled, false);
  assert.equal(result.data.settings.showUser, true);
  assert.equal(result.data.settings.size, 32);
  assert.equal(result.data.settings.shape, 'circle');
  assert.equal(result.data.settings.aiAvatarMode, 'first-per-turn');
  assert.equal(result.data.global.user, null);
  assert.deepEqual(result.data.global.assistant, ANIM);
  assert.deepEqual(result.data.workspaces.ws1, { user: PNG, assistant: null });
  assert.equal('ws2' in result.data.workspaces, false);
  assert.equal('ws3' in result.data.workspaces, false);
  assert.ok(result.warnings.includes('E_BAD_DATA'));
});

test('aiAvatarMode：默认 every-step，仅接受 every-step/first-per-turn', () => {
  const s = loadStorage(memoryStorage());
  assert.equal(s.DEFAULT_SETTINGS.aiAvatarMode, 'every-step');
  assert.deepEqual(s.AI_AVATAR_MODES, ['every-step', 'first-per-turn']);
  assert.equal(s.sanitizeData({ settings: { aiAvatarMode: 'first-per-turn' } }).data.settings.aiAvatarMode, 'first-per-turn');
  assert.equal(s.sanitizeData({ settings: { aiAvatarMode: 'weird' } }).data.settings.aiAvatarMode, 'every-step');
  assert.equal(s.sanitizeData({ settings: {} }).data.settings.aiAvatarMode, 'every-step');
  assert.equal(s.sanitizeData({}).data.settings.aiAvatarMode, 'every-step');
});

test('拍一拍设置：默认值、逐字段回落、文案归一化', () => {
  const s = loadStorage(memoryStorage());
  const defaults = { enabled: true, sound: true, volume: 60, userText: '', assistantText: '' };
  assert.deepEqual(s.DEFAULT_SETTINGS.poke, defaults);
  assert.deepEqual(s.sanitizeData({}).data.settings.poke, defaults);
  const custom = s.sanitizeData({
    settings: { poke: { enabled: false, sound: false, volume: 25, userText: '  你好   呀  ', assistantText: 123 } }
  }).data.settings.poke;
  assert.deepEqual(custom, { enabled: false, sound: false, volume: 25, userText: '你好 呀', assistantText: '' });
  assert.equal(s.sanitizeData({ settings: { poke: { userText: 'x'.repeat(60) } } }).data.settings.poke.userText.length, 40);
  assert.equal(s.sanitizeData({ settings: { poke: { userText: 'a\u0000b\u001fc' } } }).data.settings.poke.userText, 'a b c');
  const bad = s.sanitizeData({ settings: { poke: { volume: 101, enabled: 0 } } }).data.settings.poke;
  assert.equal(bad.volume, 60);
  assert.equal(bad.enabled, false);
  // 旧数据（无 poke 字段）读取补默认，不影响其它设置。
  const legacy = s.sanitizeData({ settings: { size: 40 } }).data.settings;
  assert.equal(legacy.size, 40);
  assert.deepEqual(legacy.poke, defaults);
});

test('工作区卡折叠状态：默认折叠，缺省回落默认，显式 false 展开', () => {
  const s = loadStorage(memoryStorage());
  assert.equal(s.DEFAULT_SETTINGS.workspacesCollapsed, true);
  assert.equal(s.sanitizeData({}).data.settings.workspacesCollapsed, true);
  assert.equal(s.sanitizeData({ settings: { workspacesCollapsed: false } }).data.settings.workspacesCollapsed, false);
  assert.equal(s.sanitizeData({ settings: { workspacesCollapsed: true } }).data.settings.workspacesCollapsed, true);
});

test('sanitizeData 拒绝 __proto__ 工作区键（防原型污染）', () => {
  const s = loadStorage(memoryStorage());
  const raw = JSON.parse('{"workspaces":{"__proto__":{"user":"' + PNG + '"}}}');
  const result = s.sanitizeData(raw);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.workspaces, '__proto__'), false);
  assert.equal(result.data.workspaces.user, undefined);
  assert.ok(result.warnings.includes('E_BAD_DATA'));
});

test('migrateData：v1 → v2 只升版本号，未知/非法 schema 抛 E_MIGRATION', () => {
  const s = loadStorage(memoryStorage());
  const migrated = s.migrateData({ schemaVersion: 1, global: { user: PNG } });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.global.user, PNG);
  assert.equal(s.migrateData({ schemaVersion: 2 }).schemaVersion, 2);
  assert.throws(
    () => s.migrateData({ schemaVersion: 0 }),
    (error) => error.code === 'E_MIGRATION'
  );
});

test('loadStoreState 空存储返回默认值且存储可用', () => {
  const s = loadStorage(memoryStorage());
  const result = s.loadStoreState();
  assert.equal(result.storageAvailable, true);
  assert.equal(result.readonly, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.data.settings.size, 32);
  assert.equal(result.data.schemaVersion, 2);
});

test('loadStoreState 读取合法 v2 数据并保留设置/头像/updatedAt', () => {
  const module0 = loadStorage(memoryStorage());
  const data = module0.defaultData();
  data.settings.enabled = false;
  data.settings.size = 40;
  data.global.user = PNG;
  data.global.assistant = ANIM;
  data.workspaces = { ws1: { user: WEBP, assistant: null } };
  data.updatedAt = '2026-10-19T00:00:00.000Z';
  const storage = memoryStorage({ [KEY]: JSON.stringify(data) });
  const s = loadStorage(storage);
  const result = s.loadStoreState();
  assert.deepEqual(result.warnings, []);
  assert.equal(result.readonly, false);
  assert.deepEqual(result.data, data);
  assert.equal(storage.getItem(BROKEN_KEY), null, 'v2 数据不需要迁移备份');
});

test('loadStoreState v1 数据：迁移前备份原始值，迁移后字符串头像保留', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    pluginVersion: '0.1.0',
    settings: { enabled: true, size: 36, shape: 'rounded' },
    global: { user: PNG, assistant: null },
    workspaces: { ws1: { user: WEBP, assistant: null } },
    updatedAt: '2026-10-19T00:00:00.000Z'
  });
  const storage = memoryStorage({ [KEY]: raw });
  const s = loadStorage(storage);
  const result = s.loadStoreState();
  assert.deepEqual(result.warnings, []);
  assert.equal(result.data.schemaVersion, 2);
  assert.equal(result.data.settings.size, 36);
  assert.equal(result.data.global.user, PNG);
  assert.equal(result.data.workspaces.ws1.user, WEBP);
  assert.equal(storage.getItem(BROKEN_KEY), raw, '迁移前应备份原始 v1 值');
  assert.equal(storage.getItem(KEY), raw, '读取阶段不覆盖原 key（下次提交才写 v2）');
});

test('loadStoreState 损坏 JSON：默认值 + E_BAD_DATA + .broken 备份（只写一次）', () => {
  const storage = memoryStorage({ [KEY]: '{broken json', [BROKEN_KEY]: 'first-evidence' });
  const s = loadStorage(storage);
  const result = s.loadStoreState();
  assert.ok(result.warnings.includes('E_BAD_DATA'));
  assert.equal(result.data.settings.size, 32);
  assert.equal(storage.getItem(KEY), '{broken json');
  assert.equal(storage.getItem(BROKEN_KEY), 'first-evidence');
});

test('loadStoreState 更高 schema：只读 + E_NEWER_SCHEMA，不迁移不覆盖', () => {
  const raw = JSON.stringify({
    schemaVersion: 3,
    settings: { enabled: false, size: 36 },
    global: { user: PNG, assistant: null },
    workspaces: { ws9: { user: WEBP, assistant: null } },
    updatedAt: '2026-10-19T00:00:00.000Z'
  });
  const storage = memoryStorage({ [KEY]: raw });
  const s = loadStorage(storage);
  const result = s.loadStoreState();
  assert.equal(result.readonly, true);
  assert.ok(result.warnings.includes('E_NEWER_SCHEMA'));
  assert.equal(result.data.settings.enabled, false);
  assert.equal(result.data.settings.size, 36);
  assert.equal(result.data.global.user, PNG);
  assert.equal(storage.getItem(KEY), raw);
});

test('loadStoreState 迁移失败：默认值 + E_MIGRATION + 备份', () => {
  const raw = JSON.stringify({ schemaVersion: 0, settings: { size: 40 } });
  const storage = memoryStorage({ [KEY]: raw });
  const s = loadStorage(storage);
  const result = s.loadStoreState();
  assert.ok(result.warnings.includes('E_MIGRATION'));
  assert.equal(result.data.settings.size, 32);
  assert.equal(storage.getItem(BROKEN_KEY), raw);
});

test('loadStoreState 存储不可用：内存模式 + E_STORAGE_UNAVAILABLE', () => {
  const blocked = {
    getItem() {
      throw new Error('blocked by privacy mode');
    },
    setItem() {
      throw new Error('blocked by privacy mode');
    }
  };
  const s = loadStorage(blocked);
  const result = s.loadStoreState();
  assert.equal(result.storageAvailable, false);
  assert.ok(result.warnings.includes('E_STORAGE_UNAVAILABLE'));
});

test('persistStoreData 成功写入；配额满返回 E_STORAGE_QUOTA 且不提交', () => {
  const storage = memoryStorage();
  const s = loadStorage(storage);
  const data = s.defaultData();
  assert.deepEqual(s.persistStoreData(data), { ok: true });
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), data);

  const quotaStorage = {
    getItem() {
      return null;
    },
    setItem() {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
  };
  const quota = loadStorage(quotaStorage);
  const result = quota.persistStoreData(data);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_STORAGE_QUOTA');
});

test('导出 → 清除 → 导入往返一致（含动图对象与持久化重读）', () => {
  const storage = memoryStorage();
  const s = loadStorage(storage);
  const data = s.defaultData();
  data.settings.size = 40;
  data.settings.shape = 'rounded';
  data.global.user = PNG;
  data.global.assistant = ANIM;
  data.workspaces = { ws1: { user: WEBP, assistant: null }, ws2: { user: null, assistant: JPEG } };
  data.updatedAt = '2026-10-19T00:00:00.000Z';

  assert.deepEqual(s.persistStoreData(data), { ok: true });
  const exported = s.buildExportPayload(data);
  assert.equal(exported.format, 'dsh-chat-avatars');
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.data.global.assistant.kind, 'animated');
  assert.equal(typeof exported.exportedAt, 'string');

  storage.removeItem(KEY); // 模拟“清除全部”
  assert.equal(storage.getItem(KEY), null);

  const imported = s.parseImportPayload(JSON.stringify(exported));
  assert.deepEqual(imported.data, data);
  assert.equal(imported.images, 4);
  assert.equal(imported.animated, 1);
  assert.equal(imported.workspaces, 2);
  assert.deepEqual(imported.warnings, []);

  assert.deepEqual(s.persistStoreData(imported.data), { ok: true });
  const reloaded = s.loadStoreState();
  assert.deepEqual(reloaded.data, data);
});

test('parseImportPayload 只接受 schemaVersion 2，拒绝非法 JSON/格式/版本且不部分写入', () => {
  const storage = memoryStorage();
  const s = loadStorage(storage);
  const invalid = [
    'not json',
    JSON.stringify({ format: 'other', schemaVersion: 2, data: {} }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 1, data: {} }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 0, data: {} }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 3, data: {} }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 2 }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 2, data: 'nope' }),
    JSON.stringify({ format: 'dsh-chat-avatars', schemaVersion: 2, data: [] })
  ];
  for (const text of invalid) {
    assert.throws(
      () => s.parseImportPayload(text),
      (error) => error.code === 'E_IMPORT_INVALID',
      '应拒绝: ' + text
    );
  }
  assert.equal(storage.getItem(KEY), null);
});

test('estimateBytes / countAnimatedAvatars', () => {
  const s = loadStorage(memoryStorage());
  const data = s.defaultData();
  data.global.assistant = ANIM;
  data.workspaces = { ws1: { user: ANIM, assistant: PNG } };
  assert.equal(s.estimateBytes(data), JSON.stringify(data).length);
  assert.equal(s.estimateBytes(null), 0);
  assert.equal(s.countAnimatedAvatars(data), 2);
  assert.equal(s.countAnimatedAvatars(null), 0);
  assert.equal(s.isAnimatedAvatar(ANIM), true);
  assert.equal(s.isAnimatedAvatar(PNG), false);
});

test('parseImportPayload 结构/字段边界扩展（schema v2）', () => {
  const s = loadStorage(memoryStorage());
  const imported = s.parseImportPayload(JSON.stringify({
    format: 'dsh-chat-avatars',
    schemaVersion: 2,
    pluginVersion: '9.9.9',
    exportedAt: '2026-10-19T00:00:00.000Z',
    data: {
      schemaVersion: 1,
      settings: { size: 999, unknownSetting: 1 },
      global: { user: 'bad', assistant: ANIM },
      workspaces: { ws1: { user: PNG }, ws2: { user: null } },
      unknownTop: true
    }
  }));
  assert.equal(imported.data.settings.size, 32);
  assert.equal(imported.data.global.user, null);
  assert.deepEqual(imported.data.global.assistant, ANIM);
  assert.equal(imported.data.workspaces.ws1.user, PNG);
  assert.equal(imported.data.workspaces.ws2, undefined);
  assert.equal(imported.data.pluginVersion, '0.1.0');
  assert.equal(imported.data.schemaVersion, 2, '导入后归一化为当前 schema');
  assert.equal(imported.data.unknownTop, undefined);
  assert.equal(imported.images, 2);
  assert.equal(imported.animated, 1);
  assert.equal(imported.workspaces, 1);
  assert.ok(imported.warnings.includes('E_BAD_DATA'));
});

test('sanitizeData 忽略未知字段并规范化布尔/updatedAt', () => {
  const s = loadStorage(memoryStorage());
  const result = s.sanitizeData({
    schemaVersion: 1,
    updatedAt: 123,
    settings: { enabled: 0, showUser: '', showAssistant: 'yes', unknownSetting: 1 },
    global: { user: PNG },
    workspaces: {},
    extra: true
  });
  assert.equal(result.data.schemaVersion, 2);
  assert.equal(typeof result.data.updatedAt, 'string');
  assert.equal(result.data.settings.enabled, false);
  assert.equal(result.data.settings.showUser, false);
  assert.equal(result.data.settings.showAssistant, true);
  assert.equal(result.data.settings.unknownSetting, undefined);
  assert.equal(result.data.extra, undefined);
});
