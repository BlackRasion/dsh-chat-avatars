// M1-5 版本/契约探针测试：从 src/15-status.js 的源码标记区提取纯函数与探针，
// 覆盖 semver 比较、支持区间边界、host release 读取、DOM 契约判定与暂停原因。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/15-status.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-status:start';
const END = '// @chat-avatars-status:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/15-status.js 缺少 @chat-avatars-status 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({
  testedDsh: Object.freeze(['0.2.1-rc.2']),
  supportedRange: '>=0.2.1-rc.2 <0.3.0',
  minDsh: '0.2.1-rc.2',
  bootGlobal: '__DSH_BOOT__',
  attrs: Object.freeze({
    flowKey: 'data-chat-flow-key',
    flowKind: 'data-chat-flow-kind',
    conversationSession: 'data-conversation-session'
  })
});
const ERROR_CODES = Object.freeze({
  CONTRACT: 'E_CONTRACT',
  VERSION_UNSUPPORTED: 'E_VERSION_UNSUPPORTED'
});

function loadStatus(win, doc) {
  const factory = new Function(
    'CONTRACT',
    'ERROR_CODES',
    'window',
    'document',
    "'use strict';\n" +
      BLOCK +
      '\nreturn { parseVersion, compareVersions, versionSupported, readHostRelease,' +
      ' detectContract, evaluateStatusProbe };'
  );
  return factory(CONTRACT, ERROR_CODES, win, doc);
}

function makeDoc(config) {
  const settings = config || {};
  return {
    querySelectorAll(selector) {
      if (selector === '[data-chat-flow-key]') return new Array(settings.flowKeys || 0).fill(null);
      if (selector === '[data-chat-flow-kind]') return new Array(settings.flowKinds || 0).fill(null);
      if (selector === '[data-conversation-session]') return new Array(settings.sessionRoots || 0).fill(null);
      return [];
    },
    querySelector(selector) {
      if (selector === '[data-conversation-session]') return settings.sessionRoots ? {} : null;
      return null;
    }
  };
}
function makeWindow(version, commit) {
  return {
    __DSH_BOOT__: {
      release: version === undefined ? undefined : { version: version, commit: commit }
    }
  };
}

test('parseVersion / compareVersions 遵循 semver 预发布规则', () => {
  const s = loadStatus(undefined, undefined);
  assert.deepEqual(s.parseVersion('0.2.1-rc.2'), { major: 0, minor: 2, patch: 1, pre: ['rc', '2'] });
  assert.equal(s.parseVersion('not-a-version'), null);
  assert.equal(s.parseVersion(''), null);
  const args = ['0.2.1-rc.2', '0.2.1-rc.2', 0];
  assert.equal(s.compareVersions(s.parseVersion(args[0]), s.parseVersion(args[1])), args[2]);
  assert.equal(s.compareVersions(s.parseVersion('0.2.1-rc.2'), s.parseVersion('0.2.1')), -1);
  assert.equal(s.compareVersions(s.parseVersion('0.2.1'), s.parseVersion('0.2.1-rc.2')), 1);
  assert.equal(s.compareVersions(s.parseVersion('0.2.1-rc.2'), s.parseVersion('0.2.1-rc.10')), -1);
  assert.equal(s.compareVersions(s.parseVersion('0.2.1-alpha'), s.parseVersion('0.2.1-beta')), -1);
  assert.equal(s.compareVersions(s.parseVersion('0.2.1-1'), s.parseVersion('0.2.1-alpha')), -1);
});

test('versionSupported 覆盖支持区间边界', () => {
  const s = loadStatus(undefined, undefined);
  assert.equal(s.versionSupported('0.2.1-rc.2'), true);
  assert.equal(s.versionSupported('0.2.1-rc.1'), false);
  assert.equal(s.versionSupported('0.2.1'), true);
  assert.equal(s.versionSupported('0.2.2'), true);
  assert.equal(s.versionSupported('0.2.0'), false);
  assert.equal(s.versionSupported('0.3.0'), false);
  assert.equal(s.versionSupported('0.3.0-rc.1'), false);
  assert.equal(s.versionSupported('1.0.0'), false);
  assert.equal(s.versionSupported('weird'), true, '无法解析的版本不阻断');
});

test('readHostRelease 读取 __DSH_BOOT__.release，缺失/畸形返回 null', () => {
  const s = loadStatus(makeWindow('0.2.1-rc.2', 'abc123'), undefined);
  assert.deepEqual(s.readHostRelease(), { version: '0.2.1-rc.2', commit: 'abc123' });
  assert.equal(loadStatus(makeWindow(undefined), undefined).readHostRelease(), null);
  assert.equal(loadStatus({ __DSH_BOOT__: { release: { version: 42 } } }, undefined).readHostRelease(), null);
  assert.equal(loadStatus(undefined, undefined).readHostRelease(), null);
});

test('detectContract 区分 ok / no-rows / missing / unknown', () => {
  assert.equal(loadStatus(undefined, makeDoc({ flowKeys: 2, flowKinds: 3 })).detectContract(), 'ok');
  assert.equal(loadStatus(undefined, makeDoc({ flowKeys: 0, sessionRoots: 1 })).detectContract(), 'no-rows');
  assert.equal(loadStatus(undefined, makeDoc({ flowKeys: 2, flowKinds: 0 })).detectContract(), 'missing');
  assert.equal(loadStatus(undefined, makeDoc({})).detectContract(), 'unknown');
  const throwing = {
    querySelectorAll() {
      throw new Error('dom blocked');
    },
    querySelector() {
      return null;
    }
  };
  assert.equal(loadStatus(undefined, throwing).detectContract(), 'unknown');
  assert.equal(loadStatus(undefined, undefined).detectContract(), 'unknown');
});

test('evaluateStatusProbe：版本未验证/不受支持/契约缺失组合出暂停原因', () => {
  const tested = loadStatus(makeWindow('0.2.1-rc.2', 'abc'), makeDoc({ flowKeys: 1, flowKinds: 1 }));
  const testedResult = tested.evaluateStatusProbe(false);
  assert.equal(testedResult.versionStatus, 'tested');
  assert.equal(testedResult.contract, 'ok');
  assert.equal(testedResult.paused, null);
  assert.deepEqual(testedResult.pauseReasons, []);
  assert.equal(testedResult.host.version, '0.2.1-rc.2');

  const unverified = loadStatus(makeWindow('0.2.2'), makeDoc({ flowKeys: 1, flowKinds: 1 })).evaluateStatusProbe(false);
  assert.equal(unverified.versionStatus, 'unverified');
  assert.equal(unverified.paused, null);

  const unsupported = loadStatus(makeWindow('0.3.0'), makeDoc({ flowKeys: 1, flowKinds: 1 })).evaluateStatusProbe(false);
  assert.equal(unsupported.versionStatus, 'unsupported');
  assert.equal(unsupported.paused, 'E_VERSION_UNSUPPORTED');
  assert.deepEqual(unsupported.pauseReasons, ['E_VERSION_UNSUPPORTED']);

  const missing = loadStatus(makeWindow('0.2.1-rc.2'), makeDoc({ flowKeys: 1, flowKinds: 0 })).evaluateStatusProbe(false);
  assert.equal(missing.contract, 'missing');
  assert.equal(missing.paused, 'E_CONTRACT');
  assert.deepEqual(missing.pauseReasons, ['E_CONTRACT']);

  const override = loadStatus(makeWindow('0.2.1-rc.2'), makeDoc({ flowKeys: 1, flowKinds: 0 })).evaluateStatusProbe(true);
  assert.equal(override.paused, null, 'override 时忽略契约暂停');
  assert.deepEqual(override.pauseReasons, []);
});

test('evaluateStatusProbe：无 host / 无 DOM 时安全降级', () => {
  const result = loadStatus(undefined, undefined).evaluateStatusProbe(false);
  assert.equal(result.host, null);
  assert.equal(result.contract, 'unknown');
  assert.equal(result.versionStatus, 'unknown');
  assert.equal(result.paused, null);
  assert.deepEqual(result.pauseReasons, []);
  assert.equal(typeof result.checkedAt, 'number');
});

test('versionSupported 预发布与 0.2.x 边界扩展', () => {
  const s = loadStatus(undefined, undefined);
  assert.equal(s.versionSupported('0.2.1-rc.3'), true);
  assert.equal(s.versionSupported('0.2.1-rc.10'), true);
  assert.equal(s.versionSupported('0.2.1-rc.1'), false);
  assert.equal(s.versionSupported('0.2.1-alpha'), false);
  assert.equal(s.versionSupported('0.2.9'), true);
  assert.equal(s.versionSupported('0.2.0'), false);
  assert.equal(s.versionSupported('0.1.99'), false);
  assert.equal(s.versionSupported('0.3.0-rc.1'), false);
  assert.equal(s.versionSupported('1.0.0'), false);
  assert.equal(s.versionSupported(''), true);
  assert.equal(s.versionSupported('0.2.1+build'), true);
});

test('evaluateStatusProbe 多原因顺序与 override 边界', () => {
  const both = loadStatus(makeWindow('0.3.0'), makeDoc({ flowKeys: 1, flowKinds: 0 })).evaluateStatusProbe(false);
  assert.deepEqual(both.pauseReasons, ['E_CONTRACT', 'E_VERSION_UNSUPPORTED']);
  assert.equal(both.paused, 'E_CONTRACT');
  const overridden = loadStatus(makeWindow('0.3.0'), makeDoc({ flowKeys: 1, flowKinds: 0 })).evaluateStatusProbe(true);
  assert.deepEqual(overridden.pauseReasons, ['E_VERSION_UNSUPPORTED']);
  assert.equal(overridden.paused, 'E_VERSION_UNSUPPORTED');
  const noRows = loadStatus(makeWindow('0.2.2'), makeDoc({ flowKeys: 0, sessionRoots: 1 })).evaluateStatusProbe(false);
  assert.equal(noRows.contract, 'no-rows');
  assert.equal(noRows.paused, null);
});
