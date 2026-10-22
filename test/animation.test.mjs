// M5 动图管线纯函数测试：从 src/51-animation.js 源码标记区提取，
// 覆盖格式/动图魔数嗅探、自适应帧计划、中点采样、帧下标映射、frameMs clamp、降级阶梯与雪碧图尺寸；
// M5-6 A 优化新增让出预算/候选画布计划/大画布探底阈值断言。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/51-animation.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-animation:start';
const END = '// @chat-avatars-animation:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/51-animation.js 缺少 @chat-avatars-animation 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONSTANTS = {
  ANIM_INPUT_BYTES: 6 * 1024 * 1024,
  ANIM_TARGET_FPS: 12,
  ANIM_MIN_FRAMES: 8,
  ANIM_MAX_FRAMES: 96,
  ANIM_DEFAULT_FRAME_US: 100000,
  ANIM_FRAME_LADDER: Object.freeze([96, 72, 64, 48, 32, 24, 16, 12, 8]),
  ANIM_FRAME_SIDES: Object.freeze([256, 192, 160, 128, 96, 64]),
  ANIM_SPRITE_MAX_WIDTH: 16383,
  ANIM_QUALITY_LADDER: Object.freeze([0.7, 0.55, 0.45]),
  ANIM_FLOOR_FIRST_PIXELS: 1500000,
  ANIM_FRAME_MS_MIN: 20,
  ANIM_FRAME_MS_MAX: 5000
};
const NAMES = Object.keys(CONSTANTS);

const api = new Function(
  ...NAMES,
  "'use strict';\n" +
    BLOCK +
    '\nreturn { detectImageFormat, formatFromMime, isAnimatedPng, isAnimatedWebp,' +
    ' normalizeFrameDurations, totalDurationsUs, buildSampleTimes, pickFrameIndex, planFrameMs,' +
    ' planSamplePlan, planAnimationFrames, planDegradeFrames, frameSideCandidates, spriteSheetSize,' +
    ' animationPlaybackMs, animationShouldYieldToMain, planBakeCanvases, animationEncodeFloorFirst };'
)(...NAMES.map((name) => CONSTANTS[name]));

function durationsOf(frames, eachUs) {
  return new Array(frames).fill(eachUs);
}

function asciiBytes(text) {
  const out = [];
  for (const char of text) out.push(char.charCodeAt(0));
  return out;
}

function pngWithChunk(type, payload) {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const length = payload ? payload.length : 0;
  bytes.push((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  bytes.push(...asciiBytes(type));
  if (payload) bytes.push(...payload);
  bytes.push(0, 0, 0, 0); // 不校验 CRC
  return new Uint8Array(bytes);
}

function webpWithChunk(type, payload) {
  const bytes = [...asciiBytes('RIFF'), 0, 0, 0, 0, ...asciiBytes('WEBP')];
  const length = payload ? payload.length : 0;
  bytes.push(...asciiBytes(type));
  bytes.push(length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff);
  if (payload) bytes.push(...payload);
  if (length & 1) bytes.push(0); // 偶数字节对齐
  return new Uint8Array(bytes);
}

test('魔数嗅探：PNG/JPEG/GIF/WebP 与 MIME 兜底', () => {
  assert.equal(api.detectImageFormat(pngWithChunk('IDAT', [1, 2, 3])), 'png');
  assert.equal(api.detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpeg');
  assert.equal(api.detectImageFormat(new Uint8Array(asciiBytes('GIF89a').concat([0, 0]))), 'gif');
  assert.equal(api.detectImageFormat(webpWithChunk('VP8 ', [1, 2])), 'webp');
  assert.equal(api.detectImageFormat(new Uint8Array([1, 2, 3])), null);
  assert.equal(api.detectImageFormat(null), null);
  assert.equal(api.formatFromMime('image/png'), 'png');
  assert.equal(api.formatFromMime('image/jpg'), 'jpeg');
  assert.equal(api.formatFromMime('image/gif'), 'gif');
  assert.equal(api.formatFromMime('image/webp'), 'webp');
  assert.equal(api.formatFromMime('image/svg+xml'), null);
});

test('PNG acTL / WebP ANIM / VP8X 动图标志识别', () => {
  assert.equal(api.isAnimatedPng(pngWithChunk('acTL', [0, 0, 0, 1, 0, 0, 0, 0])), true);
  assert.equal(api.isAnimatedPng(pngWithChunk('IDAT', [1])), false);
  assert.equal(api.isAnimatedPng(webpWithChunk('VP8 ', [1])), false);
  assert.equal(api.isAnimatedWebp(webpWithChunk('ANIM', [0, 0, 0, 0, 0, 0])), true);
  const vp8xAnimated = webpWithChunk('VP8X', [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(api.isAnimatedWebp(vp8xAnimated), true);
  const vp8xStatic = webpWithChunk('VP8X', [0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(api.isAnimatedWebp(vp8xStatic), false);
  assert.equal(api.isAnimatedWebp(pngWithChunk('IDAT', [1])), false);
});

test('normalizeFrameDurations：缺失/非法时长回退 100ms', () => {
  assert.deepEqual(api.normalizeFrameDurations([1000, null, 0, -5, 'x'], 5), [1000, 100000, 100000, 100000, 100000]);
  assert.deepEqual(api.normalizeFrameDurations([10, 20], 2), [10, 20]);
  assert.deepEqual(api.normalizeFrameDurations(null, 3), [100000, 100000, 100000]);
  assert.deepEqual(api.normalizeFrameDurations([1, 2, 3], 0), [1, 2, 3]);
  assert.equal(api.totalDurationsUs([100, 200, 300]), 600);
  assert.equal(api.totalDurationsUs(null), 0);
});

test('planAnimationFrames：0.45s→8 帧/56ms，14s→96 帧/146ms，短动图取源帧数', () => {
  const short = api.planAnimationFrames(durationsOf(15, 30000));
  assert.equal(short.sourceFrames, 15);
  assert.equal(short.frames, 8);
  assert.equal(short.frameMs, 56);
  assert.equal(short.sampleTimesUs.length, 8);
  assert.equal(short.frameIndices.length, 8);
  assert.equal(short.sampleTimesUs[0], 28125);
  assert.equal(short.sampleTimesUs[7], 421875);

  const long = api.planAnimationFrames(durationsOf(140, 100000));
  assert.equal(long.sourceFrames, 140);
  assert.equal(long.frames, 96);
  assert.equal(long.frameMs, 146);
  assert.equal(long.sampleTimesUs.length, 96);
  assert.equal(long.frameIndices.length, 96);

  const tiny = api.planAnimationFrames(durationsOf(5, 100000));
  assert.equal(tiny.frames, 5, '源帧数不足 8 时取源帧数');
  assert.equal(tiny.frameMs, 100);

  assert.equal(api.planAnimationFrames(durationsOf(1, 100000)), null);
  assert.equal(api.planAnimationFrames([]), null);
  assert.equal(api.planAnimationFrames(null), null);
  assert.equal(api.planAnimationFrames([0, 0]).frames, 2);
  assert.equal(api.planAnimationFrames([0, 0]).frameMs, 100);
});

test('buildSampleTimes：中点采样与边界', () => {
  assert.deepEqual(api.buildSampleTimes(1000, 4), [125, 375, 625, 875]);
  assert.deepEqual(api.buildSampleTimes(450000, 8), [28125, 84375, 140625, 196875, 253125, 309375, 365625, 421875]);
  assert.deepEqual(api.buildSampleTimes(0, 4), []);
  assert.deepEqual(api.buildSampleTimes(1000, 0), []);
});

test('pickFrameIndex：累计时长映射与首尾 clamp', () => {
  const durations = [100, 100, 100];
  assert.equal(api.pickFrameIndex(durations, 0), 0);
  assert.equal(api.pickFrameIndex(durations, 99), 0);
  assert.equal(api.pickFrameIndex(durations, 100), 1);
  assert.equal(api.pickFrameIndex(durations, 250), 2);
  assert.equal(api.pickFrameIndex(durations, 300), 2);
  assert.equal(api.pickFrameIndex(durations, 999), 2);
  assert.equal(api.pickFrameIndex([], 10), 0);
  assert.equal(api.pickFrameIndex(durations, Number.NaN), 0);
});

test('planFrameMs / planSamplePlan：clamp 与降级重采样', () => {
  assert.equal(api.planFrameMs(100000, 2), 50);
  assert.equal(api.planFrameMs(1000, 8), 20, '下限 20ms');
  assert.equal(api.planFrameMs(100000000, 8), 5000, '上限 5000ms');
  assert.equal(api.planFrameMs(0, 8), 20);
  assert.equal(api.planFrameMs(1000, 0), 20);

  const plan = api.planSamplePlan([100000, 100000, 100000, 100000], 2);
  assert.equal(plan.frames, 2);
  assert.equal(plan.frameMs, 200);
  assert.deepEqual(plan.sampleTimesUs, [100000, 300000]);
  assert.deepEqual(plan.frameIndices, [1, 3]);
  assert.equal(api.planSamplePlan([100, 100], 99).frames, 2, '不超过源帧数');
  assert.equal(api.planSamplePlan([100, 100], 0).frames, 2);
  assert.equal(api.planSamplePlan([100, 100, 100], 12).frames, 3);
});

test('planDegradeFrames / frameSideCandidates / spriteSheetSize / animationPlaybackMs', () => {
  assert.deepEqual(api.planDegradeFrames(96), [72, 64, 48, 32, 24, 16, 12, 8]);
  assert.deepEqual(api.planDegradeFrames(24), [16, 12, 8]);
  assert.deepEqual(api.planDegradeFrames(16), [12, 8]);
  assert.deepEqual(api.planDegradeFrames(12), [8]);
  assert.deepEqual(api.planDegradeFrames(8), []);
  assert.deepEqual(api.planDegradeFrames(5), []);
  assert.deepEqual(api.planDegradeFrames(0), []);

  assert.deepEqual(api.frameSideCandidates(8), [256, 192, 160, 128, 96, 64]);
  assert.deepEqual(api.frameSideCandidates(24), [256, 192, 160, 128, 96, 64]);
  // 256×64=16384 > 16383，排除；192×96=18432 排除；160×96=15360 可用。
  assert.deepEqual(api.frameSideCandidates(64), [192, 160, 128, 96, 64]);
  assert.deepEqual(api.frameSideCandidates(96), [160, 128, 96, 64]);
  assert.deepEqual(api.frameSideCandidates(128), [96, 64]);
  assert.deepEqual(api.frameSideCandidates(0), []);
  assert.deepEqual(api.frameSideCandidates(256), []);
  assert.deepEqual(api.spriteSheetSize(24, 256), { width: 6144, height: 256 });
  assert.deepEqual(api.spriteSheetSize(96, 96), { width: 9216, height: 96 });
  assert.deepEqual(api.spriteSheetSize(8, 256), { width: 2048, height: 256 });
  assert.equal(api.spriteSheetSize(0, 256), null);
  assert.equal(api.spriteSheetSize(8, 0), null);
  assert.equal(api.animationPlaybackMs(8, 56), 448);
  assert.equal(api.animationPlaybackMs(24, 583), 13992);
  assert.equal(api.animationPlaybackMs(0, 56), 0);
});

test('A 优化：让出预算与单次解码的候选画布计划', () => {
  // 让出预算：未到预算不让出、到/超预算让出、预算非法保守让出、耗时非法不让出。
  assert.equal(api.animationShouldYieldToMain(9, 10), false);
  assert.equal(api.animationShouldYieldToMain(10, 10), true);
  assert.equal(api.animationShouldYieldToMain(12, 10), true);
  assert.equal(api.animationShouldYieldToMain(Number.NaN, 10), false);
  assert.equal(api.animationShouldYieldToMain(0, 0), true);
  assert.equal(api.animationShouldYieldToMain(100, Number.NaN), true);

  // 候选画布计划：与 frameSideCandidates 同序（尺寸降序），宽 = side×frames。
  const shortCanvases = api.planBakeCanvases(8, api.frameSideCandidates(8));
  assert.deepEqual(shortCanvases.map((canvas) => canvas.side), [256, 192, 160, 128, 96, 64]);
  assert.deepEqual(shortCanvases[0], { side: 256, width: 2048, height: 256 });
  const longCanvases = api.planBakeCanvases(96, api.frameSideCandidates(96));
  assert.deepEqual(longCanvases.map((canvas) => canvas.side), [160, 128, 96, 64]);
  assert.deepEqual(longCanvases[0], { side: 160, width: 15360, height: 160 });
  assert.deepEqual(longCanvases[3], { side: 64, width: 6144, height: 64 });
  assert.deepEqual(api.planBakeCanvases(0, [256]), []);
  assert.deepEqual(api.planBakeCanvases(8, null), []);

  // 大画布探底阈值：≥1.5M 像素先编最低质量（只改顺序，不改最终选择）。
  assert.equal(api.animationEncodeFloorFirst(2457600), true);
  assert.equal(api.animationEncodeFloorFirst(1500000), true);
  assert.equal(api.animationEncodeFloorFirst(884736), false);
  assert.equal(api.animationEncodeFloorFirst(Number.NaN), false);
  assert.equal(api.animationEncodeFloorFirst(-1), false);
});
