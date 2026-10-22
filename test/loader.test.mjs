import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const reactStub = { createElement: () => null };

async function loadPlugin(requireImpl) {
  let registration = null;
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      }
    }
  };
  const url = pathToFileURL(fileURLToPath(new URL('../client.js', import.meta.url)));
  url.searchParams.set('test', String(Math.random()));
  await import(url.href);
  assert.ok(registration, 'client.js 必须调用 window.__ModuleLoader__.load');
  assert.equal(typeof registration.factory, 'function');
  assert.equal(registration.id, pkg.name, 'module id 必须等于包名');
  return registration.factory(requireImpl);
}

test('正常 factory 返回最小插件面', async () => {
  const plugin = await loadPlugin((specifier) => {
    if (specifier === 'react') return reactStub;
    throw new Error('unexpected require: ' + specifier);
  });
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual(plugin.inject, ['slots']);
  assert.doesNotThrow(() => plugin.apply({}));
});

test('seed 抛错时降级为 no-op 插件面，且 apply 不抛错', async () => {
  const plugin = await loadPlugin(() => {
    throw new Error('seed unavailable');
  });
  assert.deepEqual(plugin.inject, []);
  assert.equal(typeof plugin.apply, 'function');
  assert.doesNotThrow(() => plugin.apply({}));
});
