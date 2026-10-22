// M3 会话内点击头像测试：从 src/65-interaction.js 的 @chat-avatars-interaction 标记区提取纯函数，
// 覆盖 kind→侧映射、命中矩形（左右/显隐/尺寸 0）、点命中与 scope 归一化；DOM/事件在真机验收覆盖。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/65-interaction.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-interaction:start';
const END = '// @chat-avatars-interaction:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/65-interaction.js 缺少 @chat-avatars-interaction 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({
  kinds: Object.freeze({ user: 'user', steering: 'steering', assistant: 'assistant-step' })
});
const api = new Function(
  'CONTRACT',
  'HIT_TOP_OFFSET',
  "'use strict';\n" + BLOCK + '\nreturn { avatarSideForKind, parseCssPixels, computeAvatarHitRect, hitTestAvatar, resolveAvatarScope };'
)(CONTRACT, 2);

const rowRect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const pseudo = (display, size) => ({ display, width: size, height: size });

test('avatarSideForKind：user/steering -> user，assistant-step -> assistant，其它 -> null', () => {
  assert.equal(api.avatarSideForKind('user'), 'user');
  assert.equal(api.avatarSideForKind('steering'), 'user');
  assert.equal(api.avatarSideForKind('assistant-step'), 'assistant');
  assert.equal(api.avatarSideForKind('tool-call'), null);
  assert.equal(api.avatarSideForKind(undefined), null);
});

test('computeAvatarHitRect：user 右侧、assistant 左侧，top 偏移 2px', () => {
  assert.deepEqual(api.computeAvatarHitRect(rowRect(0, 100, 800, 140), pseudo('flex', '32px'), 'user'), {
    side: 'user', x: 768, y: 102, width: 32, height: 32
  });
  assert.deepEqual(api.computeAvatarHitRect(rowRect(0, 100, 800, 140), pseudo('flex', '32px'), 'assistant'), {
    side: 'assistant', x: 0, y: 102, width: 32, height: 32
  });
});

test('computeAvatarHitRect：display:none（窄屏隐藏）/ 尺寸 0 / 非法输入都返回 null', () => {
  const rect = rowRect(0, 100, 800, 140);
  assert.equal(api.computeAvatarHitRect(rect, pseudo('none', '32px'), 'user'), null);
  assert.equal(api.computeAvatarHitRect(rect, pseudo('flex', '0px'), 'user'), null);
  assert.equal(api.computeAvatarHitRect(rect, pseudo('flex', 'auto'), 'assistant'), null);
  assert.equal(api.computeAvatarHitRect(rect, pseudo('flex', '32px'), 'middle'), null);
  assert.equal(api.computeAvatarHitRect(null, pseudo('flex', '32px'), 'user'), null);
  assert.equal(api.computeAvatarHitRect(rect, null, 'user'), null);
});

test('hitTestAvatar：矩形内/边界命中，外部与 NaN 不命中', () => {
  const rect = { x: 768, y: 102, width: 32, height: 32 };
  assert.equal(api.hitTestAvatar(780, 110, rect), true);
  assert.equal(api.hitTestAvatar(768, 102, rect), true);
  assert.equal(api.hitTestAvatar(800, 134, rect), true);
  assert.equal(api.hitTestAvatar(767.9, 110, rect), false);
  assert.equal(api.hitTestAvatar(800.1, 110, rect), false);
  assert.equal(api.hitTestAvatar(780, 135, rect), false);
  assert.equal(api.hitTestAvatar(Number.NaN, 110, rect), false);
  assert.equal(api.hitTestAvatar(780, 110, null), false);
});

test('resolveAvatarScope：无工作区 -> global，有工作区 -> { workspaceId }', () => {
  assert.equal(api.resolveAvatarScope(null), 'global');
  assert.equal(api.resolveAvatarScope(undefined), 'global');
  assert.equal(api.resolveAvatarScope(''), 'global');
  assert.deepEqual(api.resolveAvatarScope('ws-1'), { workspaceId: 'ws-1' });
  assert.deepEqual(api.resolveAvatarScope(0), { workspaceId: 0 });
});

test('parseCssPixels：px 解析、非法/非正回落 0', () => {
  assert.equal(api.parseCssPixels('32px'), 32);
  assert.equal(api.parseCssPixels('12.5px'), 12.5);
  assert.equal(api.parseCssPixels('auto'), 0);
  assert.equal(api.parseCssPixels('-3px'), 0);
  assert.equal(api.parseCssPixels(null), 0);
  assert.equal(api.parseCssPixels(undefined), 0);
});
