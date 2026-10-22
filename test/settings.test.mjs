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
