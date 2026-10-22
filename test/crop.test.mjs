// M2 裁剪对话框几何测试：从 src/55-crop.js 的 @chat-avatars-crop 标记区提取纯函数，
// 覆盖 cover 基准、缩放、归一化偏移 clamp、像素拖拽换算、键盘步进与边界矩阵。
// 对话框 DOM/Canvas 行为在真机验收覆盖。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/55-crop.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-crop:start';
const END = '// @chat-avatars-crop:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/55-crop.js 缺少 @chat-avatars-crop 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CROP_LIMITS = Object.freeze({
  minZoom: 1,
  maxZoom: 4,
  wheelFactor: 1.1,
  buttonStep: 0.25,
  keyboardStep: 0.05
});

function loadCropApi() {
  const factory = new Function(
    'CROP_LIMITS',
    "'use strict';\n" + BLOCK + '\nreturn { createCropView, clampCropView, cropSourceRect, panCropView, panCropViewByPixels, zoomCropView, keyboardPanCropView };'
  );
  return factory(CROP_LIMITS);
}
const api = loadCropApi();

const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, message + ' (actual=' + actual + ', expected=' + expected + ')');
};

test('createCropView：非法尺寸返回 null，合法返回 cover 居中视图', () => {
  assert.equal(api.createCropView(0, 100), null);
  assert.equal(api.createCropView(100, -1), null);
  assert.equal(api.createCropView(Number.NaN, 100), null);
  assert.deepEqual(api.createCropView(200, 100), { zoom: 1, offsetX: 0, offsetY: 0 });
});

test('cropSourceRect：zoom=1 居中裁剪较小边（横图/竖图/方图）', () => {
  assert.deepEqual(api.cropSourceRect({ zoom: 1, offsetX: 0, offsetY: 0 }, 200, 100), { sx: 50, sy: 0, side: 100 });
  assert.deepEqual(api.cropSourceRect({ zoom: 1, offsetX: 0, offsetY: 0 }, 100, 200), { sx: 0, sy: 50, side: 100 });
  assert.deepEqual(api.cropSourceRect({ zoom: 1, offsetX: 0, offsetY: 0 }, 128, 128), { sx: 0, sy: 0, side: 128 });
});

test('cropSourceRect：缩放 2x/4x 时 side 与居中标量正确', () => {
  assert.deepEqual(api.cropSourceRect({ zoom: 2, offsetX: 0, offsetY: 0 }, 200, 100), { sx: 75, sy: 25, side: 50 });
  assert.deepEqual(api.cropSourceRect({ zoom: 4, offsetX: 0, offsetY: 0 }, 200, 100), { sx: 87.5, sy: 37.5, side: 25 });
});

test('cropSourceRect：归一化偏移 ±1 贴边，且边界 clamp 生效', () => {
  assert.deepEqual(api.cropSourceRect({ zoom: 2, offsetX: 1, offsetY: -1 }, 200, 100), { sx: 150, sy: 0, side: 50 });
  const left = api.cropSourceRect({ zoom: 1, offsetX: 1, offsetY: 0 }, 200, 100);
  assert.deepEqual(left, { sx: 100, sy: 0, side: 100 });
  const wide = api.cropSourceRect({ zoom: 1, offsetX: -1, offsetY: 0 }, 200, 100);
  assert.deepEqual(wide, { sx: 0, sy: 0, side: 100 });
});

test('clampCropView：zoom 限 [1,4]，偏移限 [-1,1]，null/NaN 有确定回退', () => {
  assert.deepEqual(api.clampCropView({ zoom: 0, offsetX: -5, offsetY: 5 }, 200, 100), { zoom: 1, offsetX: -1, offsetY: 1 });
  assert.deepEqual(api.clampCropView({ zoom: 9, offsetX: 0.5, offsetY: -0.5 }, 200, 100), { zoom: 4, offsetX: 0.5, offsetY: -0.5 });
  const safe = api.clampCropView(null, 200, 100);
  assert.equal(safe.zoom, 1);
  assert.ok(Number.isFinite(safe.offsetX) && Number.isFinite(safe.offsetY));
  assert.deepEqual(api.clampCropView({}, 200, 100), { zoom: 1, offsetX: 0, offsetY: 0 });
});

test('panCropViewByPixels：图片跟手 -> 裁剪窗口反向移动（按源图比例换算）', () => {
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  const panned = api.panCropViewByPixels(view, 10, 0, 200, 100, 100);
  near(panned.offsetX, -0.2, '向右拖 10px 应得到 -0.2 归一化偏移');
  near(panned.offsetY, 0, '较小边无水平空余时不产生纵向偏移');
  const rect = api.cropSourceRect(panned, 200, 100);
  assert.deepEqual({ sx: rect.sx, sy: rect.sy, side: rect.side }, { sx: 40, sy: 0, side: 100 });
});

test('panCropViewByPixels：方形图 zoom=1 无平移空间，拖拽不改变偏移', () => {
  const panned = api.panCropViewByPixels({ zoom: 1, offsetX: 0, offsetY: 0 }, 30, 30, 100, 100, 100);
  assert.deepEqual(panned, { zoom: 1, offsetX: 0, offsetY: 0 });
});

test('keyboardPanCropView：方向键按步长移动并对边界 clamp', () => {
  const right = api.keyboardPanCropView({ zoom: 2, offsetX: 0, offsetY: 0 }, 'ArrowRight', 200, 100);
  near(right.offsetX, 0.05, 'ArrowRight 增加 offsetX');
  const up = api.keyboardPanCropView({ zoom: 2, offsetX: 0, offsetY: 0 }, 'ArrowUp', 200, 100);
  near(up.offsetY, -0.05, 'ArrowUp 减少 offsetY');
  let edge = { zoom: 2, offsetX: 0, offsetY: 0 };
  for (let index = 0; index < 100; index += 1) edge = api.keyboardPanCropView(edge, 'ArrowRight', 200, 100);
  near(edge.offsetX, 1, '重复向右移动应 clamp 到 1');
  assert.deepEqual(api.keyboardPanCropView({ zoom: 2, offsetX: 0, offsetY: 0 }, 'Enter', 200, 100), { zoom: 2, offsetX: 0, offsetY: 0 });
});

test('zoomCropView：缩放 clamp 与偏移保持', () => {
  assert.equal(api.zoomCropView({ zoom: 1, offsetX: 0, offsetY: 0 }, 0, 200, 100).zoom, 1);
  assert.equal(api.zoomCropView({ zoom: 1, offsetX: 0, offsetY: 0 }, 9, 200, 100).zoom, 4);
  assert.deepEqual(api.zoomCropView({ zoom: 1, offsetX: 0.5, offsetY: -0.5 }, 2, 200, 100), { zoom: 2, offsetX: 0.5, offsetY: -0.5 });
});

test('边界矩阵：任意 zoom/偏移组合都裁出源图内的有效正方形', () => {
  const sizes = [[200, 100], [100, 200], [128, 128], [1, 1]];
  const zooms = [1, 1.5, 2, 3, 4];
  const offsets = [-1, -0.5, 0, 0.5, 1];
  for (const [width, height] of sizes) {
    const minSide = Math.min(width, height);
    for (const zoom of zooms) {
      for (const offsetX of offsets) {
        for (const offsetY of offsets) {
          const rect = api.cropSourceRect({ zoom, offsetX, offsetY }, width, height);
          assert.ok(rect && rect.side > 0, 'side 必须为正: ' + JSON.stringify({ width, height, zoom, offsetX, offsetY }));
          assert.ok(rect.side <= minSide + 1e-9);
          assert.ok(rect.sx >= 0 && rect.sx <= width - rect.side + 1e-9, 'sx 越界');
          assert.ok(rect.sy >= 0 && rect.sy <= height - rect.side + 1e-9, 'sy 越界');
        }
      }
    }
  }
});
