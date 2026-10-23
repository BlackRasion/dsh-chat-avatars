// 设置页「清理未使用的工作区头像」安全门禁测试：
// useWorkspaces 缺失/抛错/非数组时 validIds 不可信，必须返回空列表（禁止删除全部覆盖）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/80-settings.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-settings-orphans:start';
const END = '// @chat-avatars-settings-orphans:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/80-settings.js 缺少 @chat-avatars-settings-orphans 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const orphanWorkspaceIds = new Function("'use strict';\n" + BLOCK + '\nreturn orphanWorkspaceIds;')();

test('orphanWorkspaceIds：仅返回已就绪列表中确实失效的 id', () => {
  assert.deepEqual(orphanWorkspaceIds(true, ['a', 'b', 'c'], ['a']), ['b', 'c']);
  assert.deepEqual(orphanWorkspaceIds(true, ['1', '2'], [1]), ['2']);
  assert.deepEqual(orphanWorkspaceIds(true, ['a'], ['a']), []);
  assert.deepEqual(orphanWorkspaceIds(true, ['a'], [null, undefined]), ['a']);
});

test('orphanWorkspaceIds：工作区列表未就绪/非法输入返回空，避免误删', () => {
  assert.deepEqual(orphanWorkspaceIds(false, ['a'], []), []);
  assert.deepEqual(orphanWorkspaceIds(undefined, ['a'], []), []);
  assert.deepEqual(orphanWorkspaceIds(true, null, []), []);
  assert.deepEqual(orphanWorkspaceIds(true, ['a'], 'not-an-array'), []);
});

// M7-10 回归：新增文案空行在防抖保存回写时不能被重置掉。
const DRAFT_START = '// @chat-avatars-settings-poke-draft:start';
const DRAFT_END = '// @chat-avatars-settings-poke-draft:end';
const DRAFT_START_AT = SOURCE.indexOf(DRAFT_START);
const DRAFT_END_AT = SOURCE.indexOf(DRAFT_END);
assert.ok(DRAFT_START_AT >= 0 && DRAFT_END_AT > DRAFT_START_AT, 'src/80-settings.js 缺少拍一拍草稿标记');
const DRAFT_BLOCK = SOURCE.slice(DRAFT_START_AT + DRAFT_START.length, DRAFT_END_AT);
const draftApi = new Function(
  "'use strict';\n" + DRAFT_BLOCK + '\nreturn { pokeDraftSignature, shouldSyncPokeDraft };'
)();

test('shouldSyncPokeDraft：本地未保存编辑不被 settings 回写覆盖', () => {
  assert.equal(draftApi.shouldSyncPokeDraft({ userTexts: ['a', ''] }, '["a"]', '["a"]'), false);
  assert.equal(draftApi.shouldSyncPokeDraft({ userTexts: ['a', ''] }, '["a"]', '["old"]'), false);
  assert.equal(draftApi.shouldSyncPokeDraft(null, '["a"]', '["a"]'), false, '自身保存签名相同不回写');
  assert.equal(draftApi.shouldSyncPokeDraft(null, '["a"]', '["old"]'), true, '外部变更需要回写');
  assert.equal(draftApi.shouldSyncPokeDraft(undefined, '["a"]', null), true);
});

test('pokeDraftSignature：数组签名稳定，非数组安全归一为空数组', () => {
  assert.equal(draftApi.pokeDraftSignature(['a', ''], ['b']), '[["a",""],["b"]]');
  assert.equal(draftApi.pokeDraftSignature(['a'], []), draftApi.pokeDraftSignature(['a'], []));
  assert.equal(draftApi.pokeDraftSignature(null, undefined), '[[],[]]');
  assert.equal(draftApi.pokeDraftSignature(['a'], ['b']), '[["a"],["b"]]');
  assert.notEqual(draftApi.pokeDraftSignature(['a'], []), draftApi.pokeDraftSignature([], ['a']));
});
