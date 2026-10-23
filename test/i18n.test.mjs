// M1-4 i18n 测试：从 src/20-i18n.js 的源码标记区提取字典，
// 断言中英 key 完全对齐、关键文案存在、导入确认占位符完整。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/20-i18n.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-i18n:start';
const END = '// @chat-avatars-i18n:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/20-i18n.js 缺少 @chat-avatars-i18n 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const DICT = new Function("'use strict';\n" + BLOCK + '\nreturn DICT;')();

const REQUIRED_KEYS = [
  'title',
  'default.user',
  'default.assistant',
  'enabled',
  'appearance',
  'size',
  'shape',
  'showUser',
  'showAssistant',
  'globalDefaults',
  'slot.user',
  'slot.assistant',
  'upload',
  'replace',
  'clear',
  'restoreInherit',
  'workspaceOverrides',
  'dataTools',
  'exportBackup',
  'importBackup',
  'cleanOrphans',
  'clearAll',
  'diagnostics',
  'retryProbe',
  'overrideProbe',
  'restoreAutoProbe',
  'animatedTag',
  'crop.animatedHint',
  'busy.upload',
  'busy.processingAnim',
  'poke.textsUser',
  'poke.textsAssistant',
  'poke.addText',
  'poke.removeText',
  'poke.textsHint',
  'poke.defaultUser2',
  'poke.defaultAssistant3'
];

test('中英字典 key 完全对齐且无空文案', () => {
  const en = Object.keys(DICT.en).sort();
  const zh = Object.keys(DICT.zh).sort();
  assert.deepEqual(zh, en);
  for (const key of en) {
    assert.equal(typeof DICT.en[key], 'string');
    assert.equal(typeof DICT.zh[key], 'string');
    assert.ok(DICT.en[key].length > 0, key + ' en 为空');
    assert.ok(DICT.zh[key].length > 0, key + ' zh 为空');
  }
});

test('关键设置页/错误码/横幅文案齐全', () => {
  for (const key of REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(DICT.en, key), 'missing en key ' + key);
    assert.ok(Object.prototype.hasOwnProperty.call(DICT.zh, key), 'missing zh key ' + key);
  }
  for (const code of ['type', 'size', 'dimensions', 'decode', 'encode', 'tooLarge', 'animUnsupported', 'quota', 'storage', 'import', 'readonly', 'generic']) {
    assert.ok(Object.prototype.hasOwnProperty.call(DICT.en, 'error.' + code), 'missing error.' + code);
  }
  for (const banner of ['contract', 'unsupported', 'unverified', 'storage', 'readonly', 'writeError', 'badData', 'override']) {
    assert.ok(Object.prototype.hasOwnProperty.call(DICT.en, 'banner.' + banner), 'missing banner.' + banner);
  }
  assert.ok(DICT.en['import.confirm'].includes('{images}'));
  assert.ok(DICT.en['import.confirm'].includes('{workspaces}'));
  assert.ok(DICT.zh['import.confirm'].includes('{images}'));
  assert.ok(DICT.zh['import.confirm'].includes('{workspaces}'));
});

const RUNTIME_SOURCE = readFileSync(new URL('../src/20-i18n.js', import.meta.url), 'utf8');
const RUN_START = '// @chat-avatars-i18n-runtime:start';
const RUN_END = '// @chat-avatars-i18n-runtime:end';
const RUN_START_AT = RUNTIME_SOURCE.indexOf(RUN_START);
const RUN_END_AT = RUNTIME_SOURCE.indexOf(RUN_END);
assert.ok(RUN_START_AT >= 0 && RUN_END_AT > RUN_START_AT, 'src/20-i18n.js 缺少 i18n-runtime 标记');
const RUNTIME_BLOCK = RUNTIME_SOURCE.slice(RUN_START_AT + RUN_START.length, RUN_END_AT);
const runtimeApi = new Function(
  'DICT',
  "'use strict';\n" +
    RUNTIME_BLOCK +
    '\nreturn { bindLocaleService, readLocaleId, t, messageForCode };'
)(DICT);
const bindLocale = (snapshot) => {
  runtimeApi.bindLocaleService({
    get: () => ({
      getLocale: () => {
        if (snapshot instanceof Error) throw snapshot;
        return snapshot;
      }
    })
  });
};

test('t 读取宿主 locale，缺 key 回退 key 本身', () => {
  bindLocale({ active: 'zh' });
  assert.equal(runtimeApi.readLocaleId(), 'zh');
  assert.equal(runtimeApi.t('title'), '聊天头像');
  assert.equal(runtimeApi.t('missing.key'), 'missing.key');
  assert.equal(runtimeApi.messageForCode('E_STORAGE_QUOTA'), '本地存储已满，请先清理未使用的头像。');
  assert.equal(runtimeApi.messageForCode('E_UNKNOWN'), '操作失败。');
  bindLocale({ id: 'zh' });
  assert.equal(runtimeApi.t('title'), '聊天头像');
});

test('locale 缺失/抛错时回退英文，不与外部 state 耦合', () => {
  bindLocale(undefined);
  assert.equal(runtimeApi.readLocaleId(), 'en');
  assert.equal(runtimeApi.t('title'), 'Chat avatars');
  bindLocale(new Error('locale down'));
  assert.equal(runtimeApi.readLocaleId(), 'en');
  assert.equal(runtimeApi.t('title'), 'Chat avatars');
  runtimeApi.bindLocaleService({ get: () => { throw new Error('service down'); } });
  assert.equal(runtimeApi.readLocaleId(), 'en');
  assert.equal(runtimeApi.messageForCode('E_IMPORT_INVALID'), 'This file is not a valid avatar backup.');
});

test('locale 服务晚到：先英文，服务出现后按需切换中文', () => {
  let service = null;
  runtimeApi.bindLocaleService({ get: () => service });
  assert.equal(runtimeApi.readLocaleId(), 'en');
  assert.equal(runtimeApi.t('title'), 'Chat avatars');
  service = { getLocale: () => ({ active: 'zh' }) };
  assert.equal(runtimeApi.readLocaleId(), 'zh');
  assert.equal(runtimeApi.t('title'), '聊天头像');
  assert.equal(runtimeApi.messageForCode('E_IMPORT_INVALID'), '这个文件不是有效的头像备份。');
});

test('locale 服务缺失时按 html lang / navigator 兜底中文', () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { documentElement: { lang: 'zh-CN' } };
    runtimeApi.bindLocaleService({ get: () => undefined });
    assert.equal(runtimeApi.readLocaleId(), 'zh');
    assert.equal(runtimeApi.t('title'), '聊天头像');
    globalThis.document = { documentElement: { lang: 'not-a-language' } };
    runtimeApi.bindLocaleService({ get: () => undefined });
    assert.equal(runtimeApi.readLocaleId(), 'en');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
