// M1-6 组件安全壳测试：从 src/90-apply.js 的源码标记区提取 createSafeSlotComponent 与
// createSlotErrorBoundary，用最小 React 替身验证：render 抛错只降级、只 warn；正常时返回元素。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../src/90-apply.js', import.meta.url), 'utf8');
const START = '// @chat-avatars-boundary:start';
const END = '// @chat-avatars-boundary:end';
const START_AT = SOURCE.indexOf(START);
const END_AT = SOURCE.indexOf(END);
assert.ok(START_AT >= 0 && END_AT > START_AT, 'src/90-apply.js 缺少 @chat-avatars-boundary 标记');
const BLOCK = SOURCE.slice(START_AT + START.length, END_AT);

class FakeComponent {
  constructor(props) {
    this.props = props;
    this.state = {};
  }
  setState(next) {
    this.state = Object.assign({}, this.state, next);
  }
}

function makeReact(withComponent) {
  const React = {
    createElement(type, props) {
      return { type, props };
    }
  };
  if (withComponent) React.Component = FakeComponent;
  return React;
}

function load(React, warn) {
  const factory = new Function(
    'React',
    'warnWithCode',
    "'use strict';\n" + BLOCK + '\nreturn { createSafeSlotComponent, createSlotErrorBoundary };'
  );
  return factory(React, warn);
}

test('React.Component 不可用时退化为原组件', () => {
  const api = load(makeReact(false), () => {});
  const Component = () => null;
  assert.equal(api.createSlotErrorBoundary(Component, 'E_COMPONENT'), Component);
});

test('正常 render 返回子组件元素', () => {
  const warns = [];
  const api = load(makeReact(true), (code, error) => warns.push([code, String(error)]));
  const Child = () => null;
  const Boundary = api.createSlotErrorBoundary(Child, 'E_COMPONENT');
  const instance = new Boundary({ hello: 'world' });
  const element = instance.render();
  assert.equal(element.type, Child);
  assert.deepEqual(element.props, { hello: 'world' });
  assert.deepEqual(warns, []);
});

test('子组件 render 抛错后错误边界降级为 null 并记录可定位 warn', () => {
  const warns = [];
  const api = load(makeReact(true), (code, error) => warns.push([code, String(error && error.message)]));
  const Throwing = () => {
    throw new Error('injected component failure');
  };
  const Boundary = api.createSlotErrorBoundary(Throwing, 'E_COMPONENT');
  const instance = new Boundary({});
  instance.componentDidCatch(new Error('injected component failure'));
  instance.setState(Boundary.getDerivedStateFromError());
  assert.equal(instance.render(), null);
  assert.deepEqual(warns, [['E_COMPONENT', 'injected component failure']]);
});

test('safe wrapper 直接捕获 render 异常：只 warn、返回 null', () => {
  const warns = [];
  const api = load(makeReact(true), (code, error) => warns.push([code, String(error && error.message)]));
  const Throwing = () => {
    throw new Error('injected safe wrapper failure');
  };
  const Safe = api.createSafeSlotComponent(Throwing, 'E_COMPONENT');
  assert.equal(Safe({}), null);
  assert.deepEqual(warns, [['E_COMPONENT', 'injected safe wrapper failure']]);
});

test('safe wrapper 正常时透传子组件结果', () => {
  const api = load(makeReact(true), () => {});
  const Child = (props) => ({ type: 'child', props });
  const Safe = api.createSafeSlotComponent(Child, 'E_COMPONENT');
  assert.deepEqual(Safe({ value: 1 }), { type: 'child', props: { value: 1 } });
});

test('safe wrapper 对持续错误只 warn 一次', () => {
  const warns = [];
  const api = load(makeReact(true), (code, error) => warns.push([code, String(error && error.message)]));
  const Throwing = () => {
    throw new Error('persistent failure');
  };
  const Safe = api.createSafeSlotComponent(Throwing, 'E_COMPONENT');
  assert.equal(Safe({}), null);
  assert.equal(Safe({}), null);
  assert.equal(Safe({}), null);
  assert.equal(warns.length, 1);
  assert.deepEqual(warns[0], ['E_COMPONENT', 'persistent failure']);
});

test('非函数组件/非法边界输入安全退化', () => {
  const api = load(makeReact(true), () => {});
  assert.equal(api.createSafeSlotComponent(null, 'E_COMPONENT'), null);
  assert.equal(api.createSafeSlotComponent(undefined, 'E_COMPONENT'), undefined);
  assert.equal(api.createSlotErrorBoundary(null, 'E_COMPONENT'), null);
});

test('error boundary 对重复 componentDidCatch 只 warn 一次', () => {
  const warns = [];
  const api = load(makeReact(true), (code, error) => warns.push([code, String(error && error.message)]));
  const Throwing = () => null;
  const Boundary = api.createSlotErrorBoundary(Throwing, 'E_COMPONENT');
  const instance = new Boundary({});
  instance.componentDidCatch(new Error('boom'));
  instance.componentDidCatch(new Error('boom again'));
  assert.equal(warns.length, 1);
  assert.deepEqual(warns[0], ['E_COMPONENT', 'boom']);
});
