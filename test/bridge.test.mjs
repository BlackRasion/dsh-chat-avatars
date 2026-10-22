// M1-3/M5 会话桥纯函数测试：从 src/75-bridge.js 的源码标记区提取，
// 覆盖 workspace 定位、会话根定位、静态/动图变量换算、根属性写入/清理与 owner token 防互删。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/75-bridge.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-bridge:start';
const END = '// @chat-avatars-bridge:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/75-bridge.js 缺少 @chat-avatars-bridge 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

const CONTRACT = Object.freeze({
  attrs: Object.freeze({
    conversationSession: 'data-conversation-session',
    animUser: 'data-dsh-av-anim-user',
    animAssistant: 'data-dsh-av-anim-assistant'
  }),
  sides: Object.freeze(['user', 'assistant']),
  vars: Object.freeze({
    userSize: '--dsh-av-user-size',
    assistantSize: '--dsh-av-assistant-size',
    userShow: '--dsh-av-user-show',
    assistantShow: '--dsh-av-assistant-show',
    userDisplay: '--dsh-av-user-display',
    assistantDisplay: '--dsh-av-assistant-display',
    userImage: '--dsh-av-user-image',
    assistantImage: '--dsh-av-assistant-image',
    userLabel: '--dsh-av-user-label',
    assistantLabel: '--dsh-av-assistant-label',
    userFrames: '--dsh-av-user-frames',
    assistantFrames: '--dsh-av-assistant-frames',
    userAnim: '--dsh-av-user-anim',
    assistantAnim: '--dsh-av-assistant-anim',
    radius: '--dsh-av-radius'
  })
});

function makeRoot(sessionId) {
  const props = new Map();
  const attrs = new Map();
  return {
    dataset: { conversationSession: sessionId },
    attrs,
    style: {
      props,
      setProperty(name, value) {
        props.set(name, value);
      },
      removeProperty(name) {
        props.delete(name);
      }
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    }
  };
}

function makeDocument(roots) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-conversation-session]');
      return roots || [];
    }
  };
}

function loadBridge(doc) {
  const factory = new Function(
    'CONTRACT',
    'document',
    "'use strict';\n" +
      BLOCK +
      '\nreturn { pickWorkspaceId, findSessionRoots, buildAvatarVarAssignments, buildAvatarRootAttrs,' +
      ' writeAvatarVars, applyAvatarRootAttrs, clearAvatarRootAttrs, clearAvatarVars,' +
      ' createAvatarOwnerToken, claimAvatarVars, releaseAvatarVars, AV_ALL_VAR_NAMES, AV_ROOT_ATTRS };'
  );
  return factory(CONTRACT, doc);
}

const PNG = 'data:image/png;base64,AAAA';
const SPRITE = 'data:image/webp;base64,SPRITE';
const ANIMATED = Object.freeze({ frames: 8, frameMs: 56 });

function makeEffective(overrides) {
  return Object.assign(
    {
      enabled: true,
      size: 32,
      shape: 'circle',
      user: { show: true, image: PNG, animated: null, label: '' },
      assistant: { show: false, image: null, animated: null, label: 'DS' }
    },
    overrides || {}
  );
}

test('pickWorkspaceId 按 sessionIds 找所属工作区', () => {
  const s = loadBridge(makeDocument([]));
  const snapshot = {
    items: [
      { workspaceId: 'ws_a', sessionIds: ['s1', 's2'] },
      { workspaceId: 'ws_b', sessionIds: ['s3'] }
    ]
  };
  assert.equal(s.pickWorkspaceId(snapshot, 's2'), 'ws_a');
  assert.equal(s.pickWorkspaceId(snapshot, 's3'), 'ws_b');
  assert.equal(s.pickWorkspaceId(snapshot, 'missing'), null);
  assert.equal(s.pickWorkspaceId(null, 's1'), null);
  assert.equal(s.pickWorkspaceId({ items: 'bad' }, 's1'), null);
  assert.equal(s.pickWorkspaceId(snapshot, null), null);
});

test('findSessionRoots 只返回匹配 sessionId 的内容根', () => {
  const rootA = makeRoot('s1');
  const rootB = makeRoot('s2');
  const rootB2 = makeRoot('s2');
  const s = loadBridge(makeDocument([rootA, rootB, rootB2]));
  assert.deepEqual(s.findSessionRoots('s2'), [rootB, rootB2]);
  assert.deepEqual(s.findSessionRoots('missing'), []);
  assert.deepEqual(s.findSessionRoots(null), []);
  const noDoc = loadBridge(undefined);
  assert.deepEqual(noDoc.findSessionRoots('s1'), []);
});

test('buildAvatarVarAssignments 换算尺寸/显隐/图片/文案/圆角/静态动画占位', () => {
  const s = loadBridge(makeDocument([]));
  assert.deepEqual(s.buildAvatarVarAssignments({ enabled: false }), []);
  const pairs = new Map(s.buildAvatarVarAssignments(makeEffective()));
  assert.equal(pairs.get('--dsh-av-user-size'), '32px');
  assert.equal(pairs.get('--dsh-av-user-show'), '1');
  assert.equal(pairs.get('--dsh-av-user-display'), 'flex');
  assert.equal(pairs.get('--dsh-av-user-image'), 'url("' + PNG + '")');
  assert.equal(pairs.get('--dsh-av-user-label'), '""');
  assert.equal(pairs.get('--dsh-av-user-frames'), '1');
  assert.equal(pairs.get('--dsh-av-user-anim'), 'none');
  assert.equal(pairs.get('--dsh-av-assistant-show'), '0');
  assert.equal(pairs.get('--dsh-av-assistant-display'), 'none');
  assert.equal(pairs.get('--dsh-av-assistant-image'), 'none');
  assert.equal(pairs.get('--dsh-av-assistant-label'), '"DS"');
  assert.equal(pairs.get('--dsh-av-assistant-frames'), '1');
  assert.equal(pairs.get('--dsh-av-assistant-anim'), 'none');
  assert.equal(pairs.get('--dsh-av-radius'), '999px');
  const rounded = new Map(
    s.buildAvatarVarAssignments(makeEffective({ size: 40, shape: 'rounded' }))
  );
  assert.equal(rounded.get('--dsh-av-radius'), 'calc(40px * 0.22)');
});

test('动图变量：雪碧图 + frames + steps 动画 shorthand + 根属性', () => {
  const s = loadBridge(makeDocument([]));
  const effective = makeEffective({
    user: { show: true, image: SPRITE, animated: ANIMATED, label: '' },
    assistant: { show: true, image: SPRITE, animated: { frames: 24, frameMs: 583 }, label: '' }
  });
  const pairs = new Map(s.buildAvatarVarAssignments(effective));
  assert.equal(pairs.get('--dsh-av-user-image'), 'url("' + SPRITE + '")');
  assert.equal(pairs.get('--dsh-av-user-frames'), '8');
  assert.equal(pairs.get('--dsh-av-user-anim'), 'dsh-av-play-user 448ms steps(8) infinite');
  assert.equal(pairs.get('--dsh-av-assistant-frames'), '24');
  assert.equal(pairs.get('--dsh-av-assistant-anim'), 'dsh-av-play-assistant 13992ms steps(24) infinite');
  assert.deepEqual(s.buildAvatarRootAttrs(effective), [
    ['data-dsh-av-anim-user', '1'],
    ['data-dsh-av-anim-assistant', '1']
  ]);
  assert.deepEqual(s.buildAvatarRootAttrs(makeEffective()), []);
  assert.deepEqual(s.buildAvatarRootAttrs({ enabled: false }), []);
  const single = makeEffective({
    user: { show: true, image: SPRITE, animated: ANIMATED, label: '' }
  });
  assert.deepEqual(s.buildAvatarRootAttrs(single), [['data-dsh-av-anim-user', '1']]);
});

test('根属性 apply/clear：静态切换时移除另一侧，避免动画残留', () => {
  const s = loadBridge(makeDocument([]));
  const root = makeRoot('s1');
  assert.equal(s.applyAvatarRootAttrs(root, s.buildAvatarRootAttrs(makeEffective())), true);
  assert.equal(root.getAttribute('data-dsh-av-anim-user'), null);
  assert.equal(root.getAttribute('data-dsh-av-anim-assistant'), null);

  const animated = makeEffective({
    user: { show: true, image: SPRITE, animated: ANIMATED, label: '' },
    assistant: { show: true, image: SPRITE, animated: ANIMATED, label: '' }
  });
  assert.equal(s.applyAvatarRootAttrs(root, s.buildAvatarRootAttrs(animated)), true);
  assert.equal(root.getAttribute('data-dsh-av-anim-user'), '1');
  assert.equal(root.getAttribute('data-dsh-av-anim-assistant'), '1');

  const staticOnly = makeEffective({ assistant: { show: true, image: PNG, animated: null, label: '' } });
  assert.equal(s.applyAvatarRootAttrs(root, s.buildAvatarRootAttrs(staticOnly)), true);
  assert.equal(root.getAttribute('data-dsh-av-anim-user'), null);
  assert.equal(root.getAttribute('data-dsh-av-anim-assistant'), null);
  assert.equal(s.clearAvatarRootAttrs(root), true);
  assert.equal(s.applyAvatarRootAttrs(null, []), false);
});

test('writeAvatarVars 写满 15 个变量，clearAvatarVars 全部清除', () => {
  const s = loadBridge(makeDocument([]));
  const root = makeRoot('s1');
  const pairs = s.buildAvatarVarAssignments(makeEffective());
  assert.equal(s.writeAvatarVars(root, pairs), true);
  assert.equal(root.style.props.size, s.AV_ALL_VAR_NAMES.length);
  assert.equal(s.clearAvatarVars(root), true);
  assert.equal(root.style.props.size, 0);
  assert.equal(s.writeAvatarVars(null, pairs), false);
});

test('owner token：只清自己持有的根，不删别人的变量；释放时清根属性', () => {
  const s = loadBridge(makeDocument([]));
  const rootA = makeRoot('s1');
  const rootB = makeRoot('s2');
  const tokenA = s.createAvatarOwnerToken();
  const tokenB = s.createAvatarOwnerToken();
  assert.notEqual(tokenA.id, tokenB.id);

  s.claimAvatarVars(rootA, tokenA);
  s.writeAvatarVars(rootA, [['--dsh-av-user-size', '32px']]);
  s.applyAvatarRootAttrs(rootA, [['data-dsh-av-anim-user', '1']]);
  s.claimAvatarVars(rootB, tokenB);
  s.writeAvatarVars(rootB, [['--dsh-av-user-size', '24px']]);

  s.releaseAvatarVars(rootA, tokenB); // 非持有者：不清理
  assert.equal(rootA.style.props.get('--dsh-av-user-size'), '32px');
  assert.equal(rootA.getAttribute('data-dsh-av-anim-user'), '1');

  s.releaseAvatarVars(rootA, tokenA); // 持有者：变量与根属性一起清理
  assert.equal(rootA.style.props.size, 0);
  assert.equal(rootA.getAttribute('data-dsh-av-anim-user'), null);
  assert.equal(rootB.style.props.get('--dsh-av-user-size'), '24px');
  s.releaseAvatarVars(rootB, tokenB);
  assert.equal(rootB.style.props.size, 0);
});

test('buildAvatarVarAssignments 边界：缺侧/空值/rounded', () => {
  const s = loadBridge(makeDocument([]));
  const userOnly = new Map(
    s.buildAvatarVarAssignments({
      enabled: true,
      size: 24,
      shape: 'circle',
      user: { show: true, image: null, animated: null, label: 'You' }
    })
  );
  assert.equal(userOnly.get('--dsh-av-user-size'), '24px');
  assert.equal(userOnly.has('--dsh-av-assistant-size'), false);
  assert.equal(userOnly.get('--dsh-av-user-image'), 'none');
  assert.equal(userOnly.get('--dsh-av-user-frames'), '1');
  assert.equal(userOnly.get('--dsh-av-user-anim'), 'none');
  assert.equal(userOnly.get('--dsh-av-user-label'), '"You"');
  assert.equal(userOnly.get('--dsh-av-radius'), '999px');
  assert.equal(s.AV_ALL_VAR_NAMES.length, 15);
  assert.equal(new Set(s.AV_ALL_VAR_NAMES).size, 15);
  assert.deepEqual(s.AV_ROOT_ATTRS, {
    user: 'data-dsh-av-anim-user',
    assistant: 'data-dsh-av-anim-assistant'
  });

  const rounded = new Map(
    s.buildAvatarVarAssignments({
      enabled: true,
      size: 36,
      shape: 'rounded',
      user: { show: false, image: 'data:image/png;base64,AAAA', animated: null, label: '' },
      assistant: null
    })
  );
  assert.equal(rounded.get('--dsh-av-radius'), 'calc(36px * 0.22)');
  assert.equal(rounded.get('--dsh-av-user-display'), 'none');
  assert.equal(rounded.get('--dsh-av-user-label'), '""');
});
