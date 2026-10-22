// M1-4/M5 图片输入校验测试：从 src/50-image.js 的源码标记区提取纯校验函数，
// 覆盖格式白名单、静态 2MB 上限、像素/边长上限；并用源码断言固定 256 输出与质量阶梯。
// 真正 canvas 编码/动图烘焙在真机验收覆盖，纯帧采样在 test/animation.test.mjs。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/50-image.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-image:start';
const END = '// @chat-avatars-image:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/50-image.js 缺少 @chat-avatars-image 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const IMAGE_LIMITS = Object.freeze({
  staticInputBytes: 2 * 1024 * 1024,
  maxDimension: 10000,
  maxPixels: 40 * 1000 * 1000,
  outputSide: 256,
  staticMaxDataUrlChars: 120000,
  qualities: Object.freeze([0.85, 0.7, 0.6, 0.45])
});
const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

const api = new Function(
  'IMAGE_LIMITS',
  'IMAGE_TYPES',
  "'use strict';\n" + BLOCK + '\nreturn { imageStaticInputError, imageDimensionsError, centerCropRect, normalizeCropRect };'
)(IMAGE_LIMITS, IMAGE_TYPES);

const file = (type, size) => ({ type, size });

test('静态输出固定 256×256，质量阶梯与字符上限写死在源码', () => {
  assert.equal(IMAGE_LIMITS.outputSide, 256);
  assert.deepEqual(IMAGE_LIMITS.qualities, [0.85, 0.7, 0.6, 0.45]);
  assert.equal(IMAGE_LIMITS.staticMaxDataUrlChars, 120000);
  assert.ok(SOURCE.includes('outputSide: 256'), '源码应固定 outputSide: 256');
  assert.ok(SOURCE.includes('qualities: Object.freeze([0.85, 0.7, 0.6, 0.45])'), '源码应包含静态质量阶梯');
  assert.ok(!SOURCE.includes('fallbackSide'), '不应再有降尺寸回退');
});

test('imageStaticInputError 静态只接受 PNG/JPEG/WebP 且限制 2MB', () => {
  assert.equal(api.imageStaticInputError(file('image/png', 100)), null);
  assert.equal(api.imageStaticInputError(file('image/jpeg', 100)), null);
  assert.equal(api.imageStaticInputError(file('image/webp', 100)), null);
  assert.equal(api.imageStaticInputError(file('image/gif', 100)), 'E_TYPE');
  assert.equal(api.imageStaticInputError(file('image/svg+xml', 100)), 'E_TYPE');
  assert.equal(api.imageStaticInputError(null), 'E_TYPE');
  assert.equal(api.imageStaticInputError(file('image/png', IMAGE_LIMITS.staticInputBytes + 1)), 'E_SIZE');
});

test('imageDimensionsError 拒绝超大边长/像素与空尺寸', () => {
  assert.equal(api.imageDimensionsError(128, 128), null);
  assert.equal(api.imageDimensionsError(256, 256), null);
  assert.equal(api.imageDimensionsError(0, 128), 'E_DECODE');
  assert.equal(api.imageDimensionsError(10001, 100), 'E_DIMENSIONS');
  assert.equal(api.imageDimensionsError(10000, 10000), 'E_DIMENSIONS');
  assert.equal(api.imageDimensionsError(40000, 1000), 'E_DIMENSIONS');
});

test('centerCropRect：居中方形裁剪（横图/竖图/方图/非法尺寸）', () => {
  assert.deepEqual(api.centerCropRect(200, 100), { sx: 50, sy: 0, side: 100 });
  assert.deepEqual(api.centerCropRect(100, 200), { sx: 0, sy: 50, side: 100 });
  assert.deepEqual(api.centerCropRect(128, 128), { sx: 0, sy: 0, side: 128 });
  assert.equal(api.centerCropRect(0, 100), null);
  assert.equal(api.centerCropRect(100, Number.NaN), null);
});

test('normalizeCropRect：空 rect 退化居中，越界 clamp，非法 side 返回 null', () => {
  assert.deepEqual(api.normalizeCropRect(null, 200, 100), { sx: 50, sy: 0, side: 100 });
  assert.deepEqual(api.normalizeCropRect({ sx: -10, sy: -10, side: 100 }, 200, 100), { sx: 0, sy: 0, side: 100 });
  assert.deepEqual(api.normalizeCropRect({ sx: 999, sy: 999, side: 100 }, 200, 100), { sx: 100, sy: 0, side: 100 });
  assert.deepEqual(api.normalizeCropRect({ sx: 10, sy: 10, side: 999 }, 200, 100), { sx: 10, sy: 0, side: 100 });
  assert.equal(api.normalizeCropRect({ sx: 0, sy: 0, side: 0 }, 200, 100), null);
  assert.equal(api.normalizeCropRect({ side: Number.NaN }, 200, 100), null);
  assert.equal(api.normalizeCropRect(null, 0, 100), null);
  assert.deepEqual(api.normalizeCropRect({ sx: Number.NaN, sy: 999, side: 50 }, 200, 100), { sx: 0, sy: 50, side: 50 });
});
