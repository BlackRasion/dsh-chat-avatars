// M7 设置导航图标适配测试：从 src/85-settings-nav-icon.js 的 @chat-avatars-nav-icon 标记区提取，
// 覆盖按文案定位导航按钮的边界（找到/找不到/非法输入/查询抛错）。DOM/observer 在真机验收覆盖。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/85-settings-nav-icon.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-nav-icon:start';
const END = '// @chat-avatars-nav-icon:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/85-settings-nav-icon.js 缺少 @chat-avatars-nav-icon 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({ attrs: Object.freeze({ settingsNav: 'data-dsh-av-nav' }) });
const SETTINGS_NAV_CELL_SELECTOR = 'button[class*="navCell"]';
const api = new Function(
  'CONTRACT',
  'SETTINGS_NAV_CELL_SELECTOR',
  "'use strict';\n" + BLOCK + '\nreturn { findSettingsNavButton };'
)(CONTRACT, SETTINGS_NAV_CELL_SELECTOR);

function panelOf(labels) {
  const buttons = labels.map((label) => ({ textContent: ' ' + label + ' ' }));
  return { buttons, querySelectorAll: () => buttons };
}

test('findSettingsNavButton：按去空白后的文案精确匹配', () => {
  const panel = panelOf(['General', 'Chat avatars', 'Models']);
  assert.equal(api.findSettingsNavButton(panel, 'Chat avatars'), panel.buttons[1]);
  assert.equal(api.findSettingsNavButton(panel, '  Chat avatars  '), panel.buttons[1]);
  assert.equal(api.findSettingsNavButton(panel, '聊天头像'), null);
});

test('findSettingsNavButton：缺失/非法输入/查询抛错都安全返回 null', () => {
  assert.equal(api.findSettingsNavButton(null, 'Chat avatars'), null);
  assert.equal(api.findSettingsNavButton({ querySelectorAll: () => [] }, ''), null);
  assert.equal(api.findSettingsNavButton({ querySelectorAll: () => [] }, null), null);
  const throwing = {
    querySelectorAll() {
      throw new Error('blocked');
    }
  };
  assert.equal(api.findSettingsNavButton(throwing, 'Chat avatars'), null);
  const weird = { querySelectorAll: () => [null, {}, { textContent: 'Chat avatars' }] };
  assert.equal(api.findSettingsNavButton(weird, 'Chat avatars').textContent, 'Chat avatars');
});
