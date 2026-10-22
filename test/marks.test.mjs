// M4-1 「每回合每侧一次」标记纯函数测试：从 src/60-marks.js 的 @chat-avatars-marks 标记区提取函数，
// 覆盖基础/工具调用/隐藏行/分组/多回合/连续用户/steering/turn 缺失/边界矩阵；
// 该函数默认未接入 DOM，M4-2 才在性能门禁通过后消费标记。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/60-marks.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-marks:start';
const END = '// @chat-avatars-marks:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/60-marks.js 缺少 @chat-avatars-marks 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({
  kinds: Object.freeze({ user: 'user', steering: 'steering', assistant: 'assistant-step' })
});
const api = new Function(
  'CONTRACT',
  "'use strict';\n" + BLOCK + '\nreturn { avatarMarkSide, computeAvatarMarks };'
)(CONTRACT);

const marks = (rows) => api.computeAvatarMarks(rows);

test('avatarMarkSide：user/steering/assistant-step 映射，非头像行 null', () => {
  assert.equal(api.avatarMarkSide('user'), 'user');
  assert.equal(api.avatarMarkSide('steering'), 'steering');
  assert.equal(api.avatarMarkSide('assistant-step'), 'assistant');
  assert.equal(api.avatarMarkSide('tool-call'), null);
  assert.equal(api.avatarMarkSide('turn-trigger'), null);
  assert.equal(api.avatarMarkSide(undefined), null);
});

test('基础：单次发言与多回合每侧各标记一次', () => {
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: true }
  ]), ['user', 'assistant']);
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: true },
    { kind: 'user', turn: 2, visible: true },
    { kind: 'assistant-step', turn: 2, visible: true }
  ]), ['user', 'assistant', 'user', 'assistant']);
});

test('工具调用不占 assistant 名额', () => {
  assert.deepEqual(marks([
    { kind: 'assistant-step', turn: 1, visible: true },
    { kind: 'tool-call', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: true }
  ]), ['assistant', null, null]);
});

test('F4-a：隐藏行不吞掉后续可见行的头像', () => {
  assert.deepEqual(marks([
    { kind: 'tool-call', turn: 1, visible: false },
    { kind: 'assistant-step', turn: 1, visible: true }
  ]), [null, 'assistant']);
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: false },
    { kind: 'user', turn: 1, visible: true }
  ]), [null, 'user']);
});

test('F4-b：分组/连续同侧行只保留第一个可见行', () => {
  assert.deepEqual(marks([
    { kind: 'assistant-step', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: true }
  ]), ['assistant', null, null]);
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: true },
    { kind: 'user', turn: 1, visible: true }
  ]), ['user', null]);
  assert.deepEqual(marks([
    { kind: 'steering', turn: 1, visible: true },
    { kind: 'steering', turn: 1, visible: true }
  ]), ['steering', null]);
});

test('user 与 steering 分属不同标记，同回合各自各一次', () => {
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: true },
    { kind: 'steering', turn: 1, visible: true }
  ]), ['user', 'steering']);
});

test('turn 缺失时每行独立成组，不互相吞并', () => {
  assert.deepEqual(marks([
    { kind: 'assistant-step', turn: null, visible: true },
    { kind: 'assistant-step', turn: null, visible: true }
  ]), ['assistant', 'assistant']);
  assert.deepEqual(marks([
    { kind: 'assistant-step', visible: true },
    { kind: 'assistant-step', turn: 3, visible: true },
    { kind: 'assistant-step', turn: 3, visible: true }
  ]), ['assistant', 'assistant', null]);
});

test('turn 分组：数字/字符串等价、0 是有效 turn', () => {
  assert.deepEqual(marks([
    { kind: 'assistant-step', turn: '10', visible: true },
    { kind: 'assistant-step', turn: 10, visible: true }
  ]), ['assistant', null]);
  assert.deepEqual(marks([
    { kind: 'user', turn: 0, visible: true },
    { kind: 'user', turn: 0, visible: true }
  ]), ['user', null]);
});

test('边界：非数组/空数组返回 []；null 元素与未知 kind 输出 null 且保持长度', () => {
  assert.deepEqual(marks(null), []);
  assert.deepEqual(marks(undefined), []);
  assert.deepEqual(marks([]), []);
  assert.deepEqual(marks('nope'), []);
  const result = marks([null, { kind: 'tool-call', turn: 1, visible: true }, { kind: 'user', turn: 1, visible: true }]);
  assert.equal(result.length, 3);
  assert.deepEqual(result, [null, null, 'user']);
});

test('visible 为假值（false/null/undefined）都视为不可见，不占名额', () => {
  assert.deepEqual(marks([
    { kind: 'assistant-step', turn: 1, visible: false },
    { kind: 'assistant-step', turn: 1 },
    { kind: 'assistant-step', turn: 1, visible: null },
    { kind: 'assistant-step', turn: 1, visible: true }
  ]), [null, null, null, 'assistant']);
});

test('混合场景：隐藏分组后可见答案、下一回合重置', () => {
  assert.deepEqual(marks([
    { kind: 'user', turn: 1, visible: true },
    { kind: 'assistant-step', turn: 1, visible: false },
    { kind: 'assistant-step', turn: 1, visible: true },
    { kind: 'tool-call', turn: 1, visible: true },
    { kind: 'user', turn: 2, visible: true },
    { kind: 'assistant-step', turn: 2, visible: true }
  ]), ['user', null, 'assistant', null, 'user', 'assistant']);
});
