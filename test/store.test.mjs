// M1-3/M5 有效头像解析测试：从 src/40-store.js 的源码标记区提取纯函数，
// 覆盖工作区覆盖 → 全局默认 → 内置默认、非法图回退、开关与尺寸/形状透传、动图联合值解析。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/40-store.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-store:start';
const END = '// @chat-avatars-store:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/40-store.js 缺少 @chat-avatars-store 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({ build: '0.1.0' });
const SIDES = Object.freeze(['user', 'assistant']);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  size: 32,
  shape: 'circle',
  showUser: true,
  showAssistant: true
});
const LABELS = Object.freeze({ 'default.user': 'You', 'default.assistant': 'DS' });
const PNG = 'data:image/png;base64,AAAA';
const WEBP = 'data:image/webp;base64,BBBB';
const SPRITE = 'data:image/webp;base64,SPRITE';
const ANIM = Object.freeze({ kind: 'animated', v: 1, src: SPRITE, frames: 8, frameMs: 56 });

/** schema v2 联合类型校验（与 30-storage.validAvatar 语义一致的测试替身）。 */
function validAvatar(value) {
  if (typeof value === 'string') {
    return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
  return (
    !!value &&
    typeof value === 'object' &&
    value.kind === 'animated' &&
    value.v === 1 &&
    typeof value.src === 'string' &&
    Number.isInteger(value.frames) &&
    Number.isInteger(value.frameMs)
  );
}

function t(key) {
  return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key] : key;
}
function loadStore() {
  const factory = new Function(
    'CONTRACT',
    'SIDES',
    'DEFAULT_SETTINGS',
    'validAvatar',
    't',
    "'use strict';\n" + BLOCK + '\nreturn { resolveEffectiveAvatar };'
  );
  return factory(CONTRACT, SIDES, DEFAULT_SETTINGS, validAvatar, t);
}
function makeData(overrides) {
  return Object.assign(
    {
      schemaVersion: 2,
      pluginVersion: '0.1.0',
      settings: { enabled: true, size: 32, shape: 'circle', showUser: true, showAssistant: true },
      global: { user: null, assistant: null },
      workspaces: {},
      updatedAt: '2026-10-19T00:00:00.000Z'
    },
    overrides || {}
  );
}

test('总开关关闭时返回 enabled=false', () => {
  const s = loadStore();
  const effective = s.resolveEffectiveAvatar(makeData({ settings: { enabled: false } }), null);
  assert.deepEqual(effective, { enabled: false });
});

test('无覆盖时使用全局默认，无图时回退 You/DS 文案', () => {
  const s = loadStore();
  const data = makeData({ global: { user: PNG, assistant: null } });
  const effective = s.resolveEffectiveAvatar(data, null);
  assert.equal(effective.enabled, true);
  assert.equal(effective.size, 32);
  assert.equal(effective.shape, 'circle');
  assert.deepEqual(effective.user, { show: true, image: PNG, animated: null, label: '' });
  assert.deepEqual(effective.assistant, { show: true, image: null, animated: null, label: 'DS' });
  const plain = s.resolveEffectiveAvatar(makeData(), null);
  assert.equal(plain.user.label, 'You');
});

test('工作区覆盖优先于全局，未覆盖的一侧仍继承全局', () => {
  const s = loadStore();
  const data = makeData({
    global: { user: PNG, assistant: null },
    workspaces: { ws1: { user: WEBP, assistant: null } }
  });
  const effective = s.resolveEffectiveAvatar(data, 'ws1');
  assert.equal(effective.user.image, WEBP);
  assert.equal(effective.user.label, '');
  assert.equal(effective.assistant.label, 'DS');
  const other = s.resolveEffectiveAvatar(data, 'ws2');
  assert.equal(other.user.image, PNG);
});

test('动图头像解析为雪碧图 data URL + frames/frameMs', () => {
  const s = loadStore();
  const data = makeData({
    global: { user: ANIM, assistant: WEBP },
    workspaces: { ws1: { user: null, assistant: ANIM } }
  });
  const effective = s.resolveEffectiveAvatar(data, 'ws1');
  assert.equal(effective.user.image, SPRITE);
  assert.deepEqual(effective.user.animated, { frames: 8, frameMs: 56 });
  assert.equal(effective.user.label, '');
  assert.equal(effective.assistant.image, SPRITE);
  assert.deepEqual(effective.assistant.animated, { frames: 8, frameMs: 56 });
  const other = s.resolveEffectiveAvatar(data, 'ws2');
  assert.equal(other.user.image, SPRITE);
  assert.equal(other.assistant.image, WEBP);
  assert.deepEqual(other.assistant.animated, null);
});

test('非法工作区图回退全局；非法/缺失全局回退内置文案', () => {
  const s = loadStore();
  const data = makeData({
    global: { user: PNG, assistant: 'javascript:alert(1)' },
    workspaces: { ws1: { user: 'https://evil', assistant: null } }
  });
  const effective = s.resolveEffectiveAvatar(data, 'ws1');
  assert.equal(effective.user.image, PNG);
  assert.equal(effective.user.animated, null);
  assert.equal(effective.assistant.image, null);
  assert.equal(effective.assistant.label, 'DS');
});

test('显示开关与尺寸/形状透传', () => {
  const s = loadStore();
  const data = makeData({
    settings: { enabled: true, size: 40, shape: 'rounded', showUser: false, showAssistant: true }
  });
  const effective = s.resolveEffectiveAvatar(data, null);
  assert.equal(effective.size, 40);
  assert.equal(effective.shape, 'rounded');
  assert.equal(effective.user.show, false);
  assert.equal(effective.assistant.show, true);
});

test('data 缺失/畸形时不抛错并回退默认设置', () => {
  const s = loadStore();
  assert.doesNotThrow(() => s.resolveEffectiveAvatar(null, null));
  const effective = s.resolveEffectiveAvatar({ settings: null, global: null, workspaces: null }, 'ws');
  assert.equal(effective.enabled, true);
  assert.equal(effective.size, 32);
  assert.equal(effective.user.label, 'You');
});

test('resolveEffectiveAvatar 按侧回退与空 entry 处理', () => {
  const s = loadStore();
  const data = makeData({
    global: { user: PNG, assistant: null },
    workspaces: { ws1: { user: null, assistant: WEBP } }
  });
  const mixed = s.resolveEffectiveAvatar(data, 'ws1');
  assert.equal(mixed.user.image, PNG);
  assert.equal(mixed.assistant.image, WEBP);
  const emptyEntry = s.resolveEffectiveAvatar(makeData({ workspaces: { ws2: { user: null, assistant: null } } }), 'ws2');
  assert.equal(emptyEntry.user.label, 'You');
  assert.equal(emptyEntry.assistant.label, 'DS');
  assert.equal(s.resolveEffectiveAvatar(makeData(), 'missing').assistant.label, 'DS');
  assert.equal(s.resolveEffectiveAvatar(makeData(), undefined).user.label, 'You');
  assert.equal(s.resolveEffectiveAvatar(makeData(), null).user.label, 'You');
});

test('resolveEffectiveAvatar 关闭单侧后仍解析另一侧', () => {
  const s = loadStore();
  const data = makeData({
    settings: { enabled: true, size: 24, shape: 'rounded', showUser: false, showAssistant: false },
    global: { user: PNG, assistant: WEBP }
  });
  const effective = s.resolveEffectiveAvatar(data, null);
  assert.equal(effective.size, 24);
  assert.equal(effective.shape, 'rounded');
  assert.equal(effective.user.show, false);
  assert.equal(effective.assistant.show, false);
  assert.equal(effective.user.image, PNG);
  assert.equal(effective.assistant.image, WEBP);
});
