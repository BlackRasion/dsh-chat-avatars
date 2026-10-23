// M7 大图预览纯函数测试：从 src/66-avatar-preview.js 的 @chat-avatars-avatar-preview 标记区提取，
// 覆盖来源优先级（工作区 > 全局 > 内置默认）、动图/静态信息与预览内联样式（尺寸/形状/动画）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/66-avatar-preview.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-avatar-preview:start';
const END = '// @chat-avatars-avatar-preview:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/66-avatar-preview.js 缺少 @chat-avatars-avatar-preview 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const PREVIEW_SIZE_PX = 208;
const PNG = 'data:image/png;base64,AAAA';
const WEBP = 'data:image/webp;base64,BBBB';
const validAvatar = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  return typeof value === 'object' && value.kind === 'animated' && typeof value.src === 'string';
};

const api = new Function(
  'PREVIEW_SIZE_PX',
  'validAvatar',
  "'use strict';\n" + BLOCK + '\nreturn { resolvePreviewInfo, buildPreviewStyle };'
)(PREVIEW_SIZE_PX, validAvatar);

const DEFAULTS = { user: '你', assistant: 'DS' };
const DATA = {
  settings: { shape: 'circle' },
  global: { user: PNG, assistant: null },
  workspaces: {
    ws1: { user: null, assistant: { kind: 'animated', v: 1, src: WEBP, frames: 12, frameMs: 100 } }
  }
};

test('resolvePreviewInfo：工作区覆盖 > 全局 > 内置默认，并给出来源', () => {
  const user = api.resolvePreviewInfo(DATA, 'ws1', 'user', DEFAULTS);
  assert.equal(user.scope, 'global');
  assert.equal(user.image, PNG);
  assert.equal(user.animated, null);
  assert.equal(user.label, '你');
  const assistant = api.resolvePreviewInfo(DATA, 'ws1', 'assistant', DEFAULTS);
  assert.equal(assistant.scope, 'workspace');
  assert.equal(assistant.image, WEBP);
  assert.deepEqual(assistant.animated, { frames: 12, frameMs: 100 });
  const fallback = api.resolvePreviewInfo(DATA, 'ws-unknown', 'assistant', DEFAULTS);
  assert.equal(fallback.scope, 'default');
  assert.equal(fallback.image, null);
  assert.equal(fallback.animated, null);
  assert.equal(api.resolvePreviewInfo(DATA, null, 'user', DEFAULTS).scope, 'global');
  assert.equal(api.resolvePreviewInfo(DATA, 'ws1', 'middle', DEFAULTS), null);
  assert.equal(api.resolvePreviewInfo(null, null, 'user', DEFAULTS).label, '你');
});

test('resolvePreviewInfo：形状跟随设置，rounded/circle 都安全', () => {
  const rounded = api.resolvePreviewInfo({ settings: { shape: 'rounded' }, global: {}, workspaces: {} }, null, 'assistant', DEFAULTS);
  assert.equal(rounded.shape, 'rounded');
  const weird = api.resolvePreviewInfo({ settings: { shape: 'x' }, global: {}, workspaces: {} }, null, 'user', DEFAULTS);
  assert.equal(weird.shape, 'circle');
});

test('buildPreviewStyle：静态 cover/圆；动图 auto 100% + steps 动画 + 预览变量', () => {
  const staticInfo = { shape: 'circle', image: PNG, animated: null };
  const staticStyle = api.buildPreviewStyle(staticInfo);
  assert.equal(staticStyle.width, 'min(208px, 60vw)');
  assert.equal(staticStyle.height, 'min(208px, 60vw)');
  assert.equal(staticStyle.borderRadius, '999px');
  assert.equal(staticStyle.backgroundSize, 'cover');
  assert.equal(staticStyle.backgroundPosition, 'center');
  assert.equal(staticStyle.animation, 'none');
  assert.equal(staticStyle['--dsh-av-preview-size'], 'min(208px, 60vw)');
  assert.ok(staticStyle.backgroundImage.indexOf(PNG) >= 0);

  const rounded = api.buildPreviewStyle({ shape: 'rounded', image: PNG, animated: null });
  assert.equal(rounded.borderRadius, '22%');

  const animStyle = api.buildPreviewStyle({
    shape: 'circle',
    image: WEBP,
    animated: { frames: 8, frameMs: 61 }
  });
  assert.equal(animStyle.backgroundSize, 'auto 100%');
  assert.equal(animStyle.backgroundPosition, '0 0');
  assert.equal(animStyle['--dsh-av-preview-frames'], '8');
  assert.equal(animStyle.animation, 'dsh-av-preview-play 488ms steps(8) infinite');
  // 非法动图信息退回静态，不产生 NaN 动画。
  const broken = api.buildPreviewStyle({ shape: 'circle', image: WEBP, animated: { frames: 0, frameMs: 0 } });
  assert.equal(broken.animation, 'none');
  const noInfo = api.buildPreviewStyle(null);
  assert.equal(noInfo.animation, 'none');
  assert.equal(noInfo.display, 'flex');
  assert.equal(noInfo.backgroundColor, 'var(--dsw-alias-brand-primary, #6d5efc)');
  assert.ok(noInfo.backgroundImage.indexOf('linear-gradient') >= 0);
  const assistantFallback = api.buildPreviewStyle({ side: 'assistant', image: null, shape: 'circle' });
  assert.equal(assistantFallback.backgroundColor, 'var(--dsw-alias-bg-layer-2, #1f1f24)');
});

// M7-11 预览主题：桌面端浅色主题需要实色卡片/轻阴影/浅色遮罩。
const THEME_START = '// @chat-avatars-preview-theme:start';
const THEME_END = '// @chat-avatars-preview-theme:end';
const THEME_START_AT = SOURCE.indexOf(THEME_START);
const THEME_END_AT = SOURCE.indexOf(THEME_END);
assert.ok(THEME_START_AT >= 0 && THEME_END_AT > THEME_START_AT, 'src/66-avatar-preview.js 缺少预览主题标记');
const THEME_BLOCK = SOURCE.slice(THEME_START_AT + THEME_START.length, THEME_END_AT);
const themeApi = new Function(
  "'use strict';\n" + THEME_BLOCK + '\nreturn { parsePreviewColor, previewLuminance, resolvePreviewTheme };'
)();

test('parsePreviewColor：hex/rgb/rgba 解析与非法值', () => {
  assert.deepEqual(themeApi.parsePreviewColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(themeApi.parsePreviewColor('#111827'), { r: 17, g: 24, b: 39, a: 1 });
  assert.deepEqual(themeApi.parsePreviewColor('rgba(250, 250, 252, .46)'), { r: 250, g: 250, b: 252, a: 0.46 });
  assert.equal(themeApi.parsePreviewColor('transparent'), null);
  assert.equal(themeApi.parsePreviewColor('not-a-color'), null);
  assert.equal(themeApi.parsePreviewColor(undefined), null);
  assert.ok(Math.abs(themeApi.previewLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-9);
  assert.equal(themeApi.previewLuminance({ r: 0, g: 0, b: 0 }), 0);
});

test('resolvePreviewTheme：浅色 token、深色 token、背景兜底与 prefers-color-scheme', () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const previousWindow = globalThis.window;
  try {
    const root = {};
    const body = {};
    let vars = {};
    let backgrounds = new Map();
    globalThis.document = { documentElement: root, body };
    globalThis.getComputedStyle = (node) => ({
      getPropertyValue: (name) => vars[name] || '',
      backgroundColor: backgrounds.get(node) || 'transparent'
    });
    vars = { '--dsw-alias-bg-layer-1': '#ffffff' };
    assert.equal(themeApi.resolvePreviewTheme(), 'light');
    vars = { '--dsw-alias-bg-layer-2': '#111827' };
    assert.equal(themeApi.resolvePreviewTheme(), 'dark');
    vars = {};
    backgrounds = new Map([[body, 'rgb(255, 255, 255)']]);
    assert.equal(themeApi.resolvePreviewTheme(), 'light');
    backgrounds = new Map([[root, 'rgb(17, 24, 39)']]);
    assert.equal(themeApi.resolvePreviewTheme(), 'dark');
    backgrounds = new Map();
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    assert.equal(themeApi.resolvePreviewTheme(), 'dark');
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(themeApi.resolvePreviewTheme(), 'light');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousGetComputedStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousGetComputedStyle;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
