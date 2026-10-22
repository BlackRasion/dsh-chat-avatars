// M1-1/M1-2 运行时测试：零依赖 DOM/window stub，直接加载生成的 client.js，
// 断言样式幂等注入/清理、存储诊断发布、storage 事件同步与启动安全（异常注入不抛错）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const STORAGE_KEY = 'dsh.chat-avatars.v1';
const BROKEN_KEY = STORAGE_KEY + '.broken';
const CSS_ID = pkg.name + '/runtime.css';
const reactStub = { createElement() { return null; } };
let importSeq = 0;

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

function makeDocument(options) {
  const settings = options || {};
  const contract = settings.contract || {};
  const nodes = [];
  const doc = {
    nodes,
    documentElement: {},
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        dataset: {},
        textContent: '',
        _removed: false,
        remove() {
          if (this._removed) return;
          this._removed = true;
          const index = nodes.indexOf(this);
          if (index >= 0) nodes.splice(index, 1);
        }
      };
    },
    querySelectorAll(selector) {
      const text = String(selector || '');
      if (text === '[data-chat-flow-key]') return new Array(contract.flowKeys || 0).fill(null);
      if (text === '[data-chat-flow-kind]') return new Array(contract.flowKinds || 0).fill(null);
      if (text === '[data-conversation-session]') return new Array(contract.sessionRoots || 0).fill(null);
      return [];
    },
    querySelector(selector) {
      const text = String(selector || '');
      if (text === '[data-conversation-session]') return contract.sessionRoots ? { dataset: {} } : null;
      const match = /data-plugin-css="([^"]+)"/.exec(text);
      if (!match) return null;
      return nodes.find((node) => node.dataset && node.dataset.pluginCss === match[1]) || null;
    }
  };
  doc.head = {
    appendChild(element) {
      if (settings.appendThrows) throw new Error('document.head is blocked');
      nodes.push(element);
    }
  };
  return doc;
}

function makeWindow(storageImpl) {
  const listeners = new Map();
  const win = {
    localStorage: storageImpl,
    __ModuleLoader__: {
      load(registration) {
        win._registration = registration;
      }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const set = listeners.get(type);
      if (set) set.delete(handler);
    },
    dispatch(type, event) {
      const set = listeners.get(type);
      if (!set) return;
      for (const handler of Array.from(set)) handler(event);
    },
    listenerCount(type) {
      const set = listeners.get(type);
      return set ? set.size : 0;
    }
  };
  return win;
}

async function loadPlugin(win, doc) {
  globalThis.window = win;
  globalThis.document = doc;
  const url = new URL('../client.js', import.meta.url);
  url.searchParams.set('runtime', String(++importSeq));
  await import(url.href);
  assert.ok(win._registration, 'client.js 必须调用 window.__ModuleLoader__.load');
  return win._registration.factory((specifier) => {
    if (specifier === 'react') return reactStub;
    throw new Error('unexpected require: ' + specifier);
  });
}

function makeCtx() {
  const effects = [];
  return {
    effects,
    ctx: {
      effect(callback, label) {
        const cleanup = callback();
        effects.push({ label, cleanup });
        return cleanup;
      },
      get() {
        return undefined;
      }
    }
  };
}

function disposeAll(harness) {
  for (const effect of harness.effects.slice().reverse()) {
    if (typeof effect.cleanup === 'function') effect.cleanup();
  }
}

test('apply 注入 data-plugin 样式并发布存储诊断', async () => {
  const storage = memoryStorage();
  const win = makeWindow(storage);
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();

  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  assert.equal(doc.nodes.length, 1);
  const node = doc.nodes[0];
  assert.equal(node.dataset.plugin, pkg.name);
  assert.equal(node.dataset.pluginCss, CSS_ID);
  for (const fragment of [
    '[data-chat-flow-kind="assistant-step"]',
    '@container (max-width: 519px)',
    'var(--dsw-alias-brand-primary)',
    'var(--dsh-av-user-image',
    '@keyframes dsh-av-play-user',
    'data-chat-group-part="reasoning"',
    'data-state="running"',
    'data-turn-process-member',
    '.dsh-av-tag-weak',
    '.dsh-av-slider',
    'data-dsh-av-anim-assistant',
    'prefers-reduced-motion: reduce'
  ]) {
    assert.ok(node.textContent.includes(fragment), 'CSS 应包含: ' + fragment);
  }
  assert.deepEqual(
    harness.effects.map((effect) => effect.label),
    ['chat-avatars: diagnostics', 'chat-avatars: styles', 'chat-avatars: storage sync', 'chat-avatars: locale', 'chat-avatars: contract probe', 'chat-avatars: poke-audio', 'chat-avatars: settings-nav-icon']
  );

  const status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.ok(status, '应发布诊断全局');
  assert.equal(status.plugin, pkg.name);
  assert.equal(status.build, pkg.version);
  assert.equal(status.storage.available, true);
  assert.equal(status.storage.schemaVersion, 2);
  assert.deepEqual(status.storage.warnings, []);
  assert.equal(win.listenerCount('storage'), 1);

  disposeAll(harness);
  assert.equal(node._removed, true);
  assert.equal(win.__DSH_CHAT_AVATARS_STATUS__, undefined);
  assert.equal(win.listenerCount('storage'), 0);
});

test('apply 复用已有 data-plugin-css 节点（幂等，不叠加）', async () => {
  const storage = memoryStorage();
  const win = makeWindow(storage);
  const doc = makeDocument();
  const existing = doc.createElement('style');
  existing.dataset.pluginCss = CSS_ID;
  doc.head.appendChild(existing);

  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  assert.equal(doc.nodes.length, 1, '不应重复插入 style 节点');
  assert.ok(doc.nodes[0].textContent.includes('@container (min-width: 520px) and (max-width: 639px)'));
  disposeAll(harness);
  assert.equal(doc.nodes.length, 0);
});

test('storage 事件重新读取数据并更新诊断（多标签同步）', async () => {
  const validRaw = JSON.stringify({
    schemaVersion: 2,
    pluginVersion: '0.1.0',
    settings: { enabled: false, size: 40, shape: 'rounded', showUser: true, showAssistant: true },
    global: { user: null, assistant: null },
    workspaces: { ws1: { user: 'data:image/webp;base64,BBBB', assistant: null } },
    updatedAt: '2026-10-19T00:00:00.000Z'
  });
  const storage = memoryStorage({ [STORAGE_KEY]: validRaw });
  const win = makeWindow(storage);
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  plugin.apply(harness.ctx);

  let status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.ok(status.storage.bytes > 0);

  // 另一个标签页把数据写坏：本页 storage 事件后应重读、备份并暴露 E_BAD_DATA。
  storage.setItem(STORAGE_KEY, '{broken');
  win.dispatch('storage', { key: STORAGE_KEY });
  status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.ok(status.storage.warnings.includes('E_BAD_DATA'));
  assert.equal(storage.getItem(BROKEN_KEY), '{broken');

  // 与插件无关的 key 不触发重读。
  storage.setItem(STORAGE_KEY, validRaw);
  win.dispatch('storage', { key: 'unrelated-key' });
  status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.deepEqual(status.storage.warnings, ['E_BAD_DATA']);

  // key 为 null（clear()）也重读。
  win.dispatch('storage', { key: null });
  status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.deepEqual(status.storage.warnings, []);
  disposeAll(harness);
});

test('storage 事件幂等：重复派发不叠加样式/监听器，broken key 也触发重读', async () => {
  const base = {
    schemaVersion: 2,
    pluginVersion: '0.1.0',
    settings: { enabled: true, size: 32, shape: 'circle', showUser: true, showAssistant: true },
    global: { user: null, assistant: null },
    workspaces: {},
    updatedAt: '2026-10-19T00:00:00.000Z'
  };
  const rawSmall = JSON.stringify(base);
  const rawLarge = JSON.stringify(
    Object.assign({}, base, { global: { user: 'data:image/png;base64,' + 'A'.repeat(400), assistant: null } })
  );
  const storage = memoryStorage({ [STORAGE_KEY]: rawSmall });
  const win = makeWindow(storage);
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  plugin.apply(harness.ctx);

  const bytesSmall = win.__DSH_CHAT_AVATARS_STATUS__.storage.bytes;
  assert.ok(bytesSmall > 0);

  // 损坏备份 key 的变化同样应触发重读（监听白名单包含 STORAGE_KEY 与 BROKEN_KEY）。
  storage.setItem(STORAGE_KEY, rawLarge);
  win.dispatch('storage', { key: BROKEN_KEY });
  const bytesLarge = win.__DSH_CHAT_AVATARS_STATUS__.storage.bytes;
  assert.ok(bytesLarge > bytesSmall, 'broken key 事件应重新读取数据');

  // 多标签同步幂等：重复派发同一事件不叠加 style 节点、不叠加 listener。
  for (let index = 0; index < 5; index += 1) win.dispatch('storage', { key: STORAGE_KEY });
  assert.equal(doc.nodes.length, 1, 'store 通知不应重复注入样式节点');
  assert.equal(win.listenerCount('storage'), 1, 'storage 监听器不应叠加');

  // 无关 key 不重读：写入小数据但只派发无关 key，诊断占用保持上一次重读值。
  storage.setItem(STORAGE_KEY, rawSmall);
  win.dispatch('storage', { key: 'unrelated-key' });
  assert.equal(win.__DSH_CHAT_AVATARS_STATUS__.storage.bytes, bytesLarge);

  disposeAll(harness);
  assert.equal(win.listenerCount('storage'), 0, 'dispose 后应移除 storage 监听');
  assert.doesNotThrow(() => win.dispatch('storage', { key: STORAGE_KEY }), 'dispose 后事件不应抛错');
});

test('apply 在无 ctx / 无 effect / 样式注入失败时不向宿主抛错', async () => {
  const win = makeWindow(memoryStorage());
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  assert.doesNotThrow(() => plugin.apply({}));
  assert.equal(doc.nodes.length, 0);
  assert.ok(win.__DSH_CHAT_AVATARS_STATUS__);

  const blockedWin = makeWindow(memoryStorage());
  const blockedDoc = makeDocument({ appendThrows: true });
  const blockedPlugin = await loadPlugin(blockedWin, blockedDoc);
  const harness = makeCtx();
  assert.doesNotThrow(() => blockedPlugin.apply(harness.ctx));
  assert.equal(blockedDoc.nodes.length, 0);
  assert.ok(blockedWin.__DSH_CHAT_AVATARS_STATUS__);
  assert.equal(harness.effects.length, 7);
  disposeAll(harness);
});

test('apply 在宿主 effect 抛错与存储不可用时仍安全降级', async () => {
  const throwingCtx = {
    effect() {
      throw new Error('effects are blocked');
    },
    get() {
      return undefined;
    }
  };
  const win = makeWindow(memoryStorage());
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  assert.doesNotThrow(() => plugin.apply(throwingCtx));

  const blockedStorage = {
    getItem() {
      throw new Error('privacy mode');
    },
    setItem() {
      throw new Error('privacy mode');
    }
  };
  const win2 = makeWindow(blockedStorage);
  const doc2 = makeDocument();
  const plugin2 = await loadPlugin(win2, doc2);
  const harness2 = makeCtx();
  assert.doesNotThrow(() => plugin2.apply(harness2.ctx));
  const status = win2.__DSH_CHAT_AVATARS_STATUS__;
  assert.equal(status.storage.available, false);
  assert.ok(status.storage.warnings.includes('E_STORAGE_UNAVAILABLE'));
  disposeAll(harness2);
});

function makeSlots() {
  const calls = { injected: [], registered: [], disposed: 0 };
  return {
    calls,
    slots: {
      inject(name, callback) {
        calls.injected.push(name);
        const disposer = callback();
        return function () {
          calls.disposed += 1;
          if (typeof disposer === 'function') disposer();
        };
      },
      register(meta, Component) {
        calls.registered.push({ meta, Component });
        return function () {
          calls.disposed += 1;
        };
      }
    }
  };
}

test('apply 注册会话桥与设置页并安全清理', async () => {
  const win = makeWindow(memoryStorage());
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  const fakeSlots = makeSlots();
  harness.ctx.slots = fakeSlots.slots;

  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  assert.deepEqual(fakeSlots.calls.injected, ['conversation.session.header.utilities', 'settings.section']);
  assert.equal(fakeSlots.calls.registered.length, 2);
  const bridge = fakeSlots.calls.registered[0];
  assert.equal(bridge.meta.name, 'conversation.session.header.utilities');
  assert.equal(bridge.meta.id, 'chat-avatars-context');
  assert.equal(bridge.meta.order, 1000);
  assert.equal(typeof bridge.Component, 'function');
  const settings = fakeSlots.calls.registered[1];
  assert.equal(settings.meta.name, 'settings.section');
  assert.equal(settings.meta.id, 'chat-avatars');
  assert.equal(settings.meta.order, 12);
  assert.equal(typeof settings.meta.label, 'function');
  assert.equal(typeof settings.Component, 'function');
  assert.deepEqual(
    harness.effects.map((effect) => effect.label),
    [
      'chat-avatars: diagnostics',
      'chat-avatars: styles',
      'chat-avatars: storage sync',
      'chat-avatars: locale',
      'chat-avatars: contract probe',
      'chat-avatars: bridge',
      'chat-avatars: settings',
      'chat-avatars: poke-audio',
      'chat-avatars: settings-nav-icon'
    ]
  );
  assert.ok(win.__DSH_CHAT_AVATARS_STATUS__);

  disposeAll(harness);
  assert.equal(fakeSlots.calls.disposed, 4, '两个 inject 与两个 register 的 disposer 都应被调用');
});

test('slots 服务抛错时 apply 仍不向宿主抛错', async () => {
  const win = makeWindow(memoryStorage());
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  harness.ctx.slots = {
    inject() {
      throw new Error('slots are blocked');
    },
    register() {
      throw new Error('slots are blocked');
    }
  };
  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  assert.ok(win.__DSH_CHAT_AVATARS_STATUS__);
  assert.ok(!harness.effects.some((effect) => effect.label === 'chat-avatars: bridge'));
  assert.ok(!harness.effects.some((effect) => effect.label === 'chat-avatars: settings'));
});

test('版本超出支持区间时自动暂停并发布诊断', async () => {
  const win = makeWindow(memoryStorage());
  win.__DSH_BOOT__ = { release: { version: '0.3.0', commit: 'abc' } };
  const doc = makeDocument({ contract: { flowKeys: 1, flowKinds: 1 } });
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  assert.doesNotThrow(() => plugin.apply(harness.ctx));

  const status = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.equal(status.host.version, '0.3.0');
  assert.equal(status.host.commit, 'abc');
  assert.equal(status.versionStatus, 'unsupported');
  assert.equal(status.paused, 'E_VERSION_UNSUPPORTED');
  assert.deepEqual(status.pauseReasons, ['E_VERSION_UNSUPPORTED']);
  assert.deepEqual(status.tested, ['0.2.1-rc.2']);
  assert.equal(status.supportedRange, '>=0.2.1-rc.2 <0.3.0');
  disposeAll(harness);
});

test('DOM 契约缺失时暂停；契约正常时无暂停', async () => {
  const win = makeWindow(memoryStorage());
  win.__DSH_BOOT__ = { release: { version: '0.2.1-rc.2' } };
  const plugin = await loadPlugin(win, makeDocument({ contract: { flowKeys: 1, flowKinds: 0 } }));
  const harness = makeCtx();
  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  const missingStatus = win.__DSH_CHAT_AVATARS_STATUS__;
  assert.equal(missingStatus.contract, 'missing');
  assert.equal(missingStatus.paused, 'E_CONTRACT');
  disposeAll(harness);

  const win2 = makeWindow(memoryStorage());
  win2.__DSH_BOOT__ = { release: { version: '0.2.1-rc.2' } };
  const plugin2 = await loadPlugin(win2, makeDocument({ contract: { flowKeys: 1, flowKinds: 1 } }));
  const harness2 = makeCtx();
  assert.doesNotThrow(() => plugin2.apply(harness2.ctx));
  const okStatus = win2.__DSH_CHAT_AVATARS_STATUS__;
  assert.equal(okStatus.contract, 'ok');
  assert.equal(okStatus.versionStatus, 'tested');
  assert.equal(okStatus.paused, null);
  assert.deepEqual(okStatus.pauseReasons, []);
  disposeAll(harness2);
});

test('ctx.get 抛错时 apply 安全，settings label thunk 返回标题', async () => {
  const win = makeWindow(memoryStorage());
  const doc = makeDocument();
  const plugin = await loadPlugin(win, doc);
  const harness = makeCtx();
  const fakeSlots = makeSlots();
  harness.ctx.slots = fakeSlots.slots;
  harness.ctx.get = () => {
    throw new Error('services down');
  };
  assert.doesNotThrow(() => plugin.apply(harness.ctx));
  assert.ok(win.__DSH_CHAT_AVATARS_STATUS__);
  const settings = fakeSlots.calls.registered.find((entry) => entry.meta.name === 'settings.section');
  assert.ok(settings);
  assert.equal(typeof settings.meta.label, 'function');
  assert.ok(['Chat avatars', '聊天头像'].indexOf(settings.meta.label()) >= 0);
  disposeAll(harness);
});
