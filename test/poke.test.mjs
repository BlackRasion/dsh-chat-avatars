// M7-10 拍一拍纯函数测试：从 src/67-poke.js 的 @chat-avatars-poke 标记区提取。
// 覆盖单击/双击消歧、视觉/音效冷却、气泡定位、随机文案抽取与音量归一化。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/67-poke.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-poke:start';
const END = '// @chat-avatars-poke:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/67-poke.js 缺少 @chat-avatars-poke 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONSTANTS = {
  POKE_CLICK_WINDOW_MS: 260,
  POKE_VISUAL_COOLDOWN_MS: 300,
  POKE_SOUND_COOLDOWN_MS: 900,
  POKE_BUBBLE_MS: 1800,
  POKE_SHAKE_MS: 520,
  POKE_BUBBLE_GAP: 10,
  POKE_BUBBLE_MARGIN: 8,
  POKE_TEXT_MAX: 40,
  POKE_TEXTS_MAX: 8
};
const NAMES = Object.keys(CONSTANTS);
// 与 30-storage 的 sanitizePokeText 同语义的最小替身（生产环境用存储层实现）。
const sanitizePokeText = (value) => {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > CONSTANTS.POKE_TEXT_MAX ? cleaned.slice(0, CONSTANTS.POKE_TEXT_MAX) : cleaned;
};

const api = new Function(
  ...NAMES,
  'sanitizePokeText',
  "'use strict';\n" +
    BLOCK +
    '\nreturn { clampPokeValue, resolvePokeVolume, resolvePokeTexts, pickPokeText, nextAvatarClick, pokeCoolingDown, computeBubblePlacement };'
)(...NAMES.map((name) => CONSTANTS[name]), sanitizePokeText);

const rect = (x, y, width, height) => ({ x, y, width, height });
const DEFAULTS = { user: ['默认 A', '默认 B', '默认 C'], assistant: ['AI 默认'] };

test('nextAvatarClick：首次 preview、同键 260ms 内 poke、跨键/超窗 preview', () => {
  const first = api.nextAvatarClick(null, 'user|k1', 1000);
  assert.equal(first.action, 'preview');
  assert.deepEqual(first.state, { key: 'user|k1', at: 1000 });
  const second = api.nextAvatarClick(first.state, 'user|k1', 1120);
  assert.equal(second.action, 'poke');
  assert.deepEqual(second.state, { key: '', at: 0 }, '双击后清空状态，避免三连击继续判 poke');
  const third = api.nextAvatarClick(second.state, 'user|k1', 1200);
  assert.equal(third.action, 'preview');
  assert.equal(api.nextAvatarClick({ key: 'k', at: 1000 }, 'k', 1260).action, 'poke');
  assert.equal(api.nextAvatarClick({ key: 'k', at: 1000 }, 'k', 1261).action, 'preview');
  assert.equal(api.nextAvatarClick({ key: 'assistant|k1', at: 1000 }, 'user|k1', 1100).action, 'preview');
  assert.equal(api.nextAvatarClick(null, 'k', Number.NaN).action, 'preview');
});

test('pokeCoolingDown：300ms 视觉冷却 / 900ms 音效冷却，边界与非法值', () => {
  assert.equal(api.pokeCoolingDown(0, 1000, 300), false);
  assert.equal(api.pokeCoolingDown(null, 1000, 300), false);
  assert.equal(api.pokeCoolingDown(1000, 1000, 300), true);
  assert.equal(api.pokeCoolingDown(1000, 1299, 300), true);
  assert.equal(api.pokeCoolingDown(1000, 1300, 300), false);
  assert.equal(api.pokeCoolingDown(1000, 1899, 900), true);
  assert.equal(api.pokeCoolingDown(1000, 1900, 900), false);
  assert.equal(api.pokeCoolingDown(1000, 900, 300), false);
  assert.equal(api.pokeCoolingDown(1000, 1100, 0), false);
  assert.equal(api.pokeCoolingDown(Number.NaN, 1000, 300), false);
  assert.equal(api.pokeCoolingDown(1000, 1100, Number.NaN), false);
});

test('resolvePokeTexts：新数组优先、旧单条映射、默认变体、去重/截断', () => {
  assert.deepEqual(api.resolvePokeTexts({ userTexts: [' a ', 'b', 'a', ''] }, 'user', DEFAULTS), ['a', 'b']);
  assert.deepEqual(api.resolvePokeTexts({ userText: '  旧文案  ' }, 'user', DEFAULTS), ['旧文案']);
  assert.deepEqual(
    api.resolvePokeTexts({ userText: '旧', userTexts: ['新 1', '新 2'] }, 'user', DEFAULTS),
    ['新 1', '新 2']
  );
  assert.deepEqual(api.resolvePokeTexts({ userTexts: [] }, 'user', DEFAULTS), DEFAULTS.user);
  assert.deepEqual(api.resolvePokeTexts({}, 'assistant', DEFAULTS), DEFAULTS.assistant);
  assert.deepEqual(api.resolvePokeTexts({}, 'user', { user: '单条默认' }), ['单条默认']);
  assert.deepEqual(api.resolvePokeTexts({}, 'middle', DEFAULTS), []);
  assert.equal(api.resolvePokeTexts({ userTexts: ['x'.repeat(80)] }, 'user', DEFAULTS)[0].length, 40);
  const many = Array.from({ length: 12 }, (_, index) => 't' + index);
  assert.equal(api.resolvePokeTexts({ userTexts: many }, 'user', DEFAULTS).length, 8);
});

test('pickPokeText：单条固定、随机注入、避免同侧连续重复', () => {
  assert.equal(api.pickPokeText([], '', () => 0), '');
  assert.equal(api.pickPokeText(null, '', () => 0), '');
  assert.equal(api.pickPokeText(['only'], 'only', () => 0.5), 'only');
  assert.equal(api.pickPokeText(['a', 'b'], '', () => 0), 'a');
  assert.equal(api.pickPokeText(['a', 'b'], '', () => 0.99), 'b');
  assert.equal(api.pickPokeText(['a', 'b'], 'a', () => 0), 'b');
  assert.equal(api.pickPokeText(['a', 'b'], 'b', () => 0), 'a');
  assert.equal(api.pickPokeText(['a'], 'a', () => 0), 'a');
  assert.equal(api.pickPokeText(['a', 'b'], '', () => Number.NaN), 'a');
  assert.ok(['a', 'b'].includes(api.pickPokeText(['a', 'b'], '', 'not-a-function')));
});

test('computeBubblePlacement：user 在左、assistant 在右，夹取视口与尾巴', () => {
  const viewport = { width: 1000, height: 800 };
  const bubble = { width: 200, height: 60 };
  const above = api.computeBubblePlacement(rect(800, 400, 32, 32), bubble, viewport, 'user');
  assert.deepEqual(above, { left: 632, top: 330, placement: 'above', tail: 180 });
  const right = api.computeBubblePlacement(rect(10, 400, 32, 32), bubble, viewport, 'assistant');
  assert.deepEqual(right, { left: 10, top: 330, placement: 'above', tail: 20 });
  const edge = api.computeBubblePlacement(rect(940, 400, 32, 32), bubble, viewport, 'user');
  assert.equal(edge.left, 772);
  assert.equal(edge.tail, 180);
  const clamped = api.computeBubblePlacement(rect(50, 400, 32, 32), bubble, viewport, 'user');
  assert.equal(clamped.left, 8);
  assert.equal(clamped.tail, 58);
  const below = api.computeBubblePlacement(rect(500, 5, 32, 32), bubble, viewport, 'assistant');
  assert.equal(below.placement, 'below');
  assert.equal(api.computeBubblePlacement(null, bubble, viewport, 'user'), null);
  assert.equal(api.computeBubblePlacement(rect(0, 0, 0, 0), bubble, viewport, 'user'), null);
  assert.equal(api.computeBubblePlacement(rect(10, 10, 32, 32), bubble, viewport, 'middle'), null);
});

test('resolvePokeVolume / clampPokeValue：边界与非法值', () => {
  assert.equal(api.resolvePokeVolume({ volume: 0 }), 0);
  assert.equal(api.resolvePokeVolume({ volume: 100 }), 100);
  assert.equal(api.resolvePokeVolume({ volume: 101 }), 100);
  assert.equal(api.resolvePokeVolume({ volume: -1 }), 0);
  assert.equal(api.resolvePokeVolume({ volume: '55' }), 55);
  assert.equal(api.resolvePokeVolume({}), 60);
  assert.equal(api.resolvePokeVolume(null), 60);
  assert.equal(api.clampPokeValue(Number.NaN, 0, 10, 7), 7);
  assert.equal(api.clampPokeValue(12, 0, 10, 7), 10);
  assert.equal(api.clampPokeValue(-3, 0, 10, 7), 0);
});
