/**
 * @module 90-apply
 * 职责：生命周期装配——初始化存储/诊断，注入样式，挂多标签同步，注册会话桥、设置页与会话内交互层。
 * 依赖：其余全部模块。
 * 被依赖：构建外壳（client.js 的 factory 返回 { inject: ['slots'], apply }）。
 * 状态：M0~M7 装配已落地（存储/样式/桥/设置页/版本探针/启动安全/动图/互动），零运行时依赖。
 *
 * 实现红线（M1 起适用）：
 * - 本函数整体包 try/catch；每个注册点单独 try/catch；任何异常只降级，不向宿主抛。
 * - 只注册 slots/effect；不 require 宿主 client 包；不写 document.body。
 * - 所有副作用必须返回清理函数（ctx.effect）。
 */

/** 注册一个 effect；ctx 不可用或宿主拒绝时静默跳过。 */
function registerEffect(ctx, callback, label) {
  if (!ctx || typeof ctx.effect !== 'function') return false;
  try {
    ctx.effect(callback, label);
    return true;
  } catch (error) {
    warnWithCode('E_EFFECT', error);
    return false;
  }
}

function registerStyleEffect(ctx) {
  return registerEffect(ctx, installStyleSheet, 'chat-avatars: styles');
}

function registerLocaleEffect(ctx) {
  return registerEffect(ctx, registerLocaleDictionaries, 'chat-avatars: locale');
}

function registerStorageSyncEffect(ctx) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return false;
  return registerEffect(
    ctx,
    function () {
      const onStorage = function (event) {
        try {
          if (event && event.key !== null && event.key !== STORAGE_KEY && event.key !== STORAGE_BROKEN_KEY) return;
          reloadStore();
        } catch (error) {
          warnWithCode('E_STORAGE', error);
        }
      };
      window.addEventListener('storage', onStorage);
      return function () {
        try {
          window.removeEventListener('storage', onStorage);
        } catch (error) {
          warnWithCode('E_STORAGE', error);
        }
      };
    },
    'chat-avatars: storage sync'
  );
}

function registerStatusEffect(ctx) {
  return registerEffect(
    ctx,
    function () {
      publishStatus(storeDiagnostics());
      return function () {
        clearStatus();
      };
    },
    'chat-avatars: diagnostics'
  );
}

/** 执行一次版本/契约探针并把结果写入 store（暂停态由 bridge 消费）。 */
function runContractProbe() {
  try {
    const state = getStoreState();
    applyProbeResult(evaluateStatusProbe(state ? !!state.override : false));
  } catch (error) {
    warnWithCode('E_CONTRACT', error);
  }
}

/** 订阅 override / 手动重试，变化时重新探针（避免 setStoreState 自身触发循环）。 */
function registerProbeEffect(ctx) {
  return registerEffect(
    ctx,
    function () {
      const current = getStoreState();
      let lastOverride = current ? !!current.override : false;
      let lastNonce = current ? current.probeNonce || 0 : 0;
      const dispose = subscribeStore(function () {
        const state = getStoreState();
        const override = state ? !!state.override : false;
        const nonce = state ? state.probeNonce || 0 : 0;
        if (override === lastOverride && nonce === lastNonce) return;
        lastOverride = override;
        lastNonce = nonce;
        runContractProbe();
      });
      return function () {
        try {
          dispose();
        } catch (error) {}
      };
    },
    'chat-avatars: contract probe'
  );
}

// @chat-avatars-boundary:start
/**
 * Render 内核：直接调用 slot 组件并把异常收敛为 null；
 * 避免组件级异常冒泡到 React 根，只留一条可定位 warn。
 */
function createSafeSlotComponent(Component, code) {
  const label = code || 'E_COMPONENT';
  if (typeof Component !== 'function') return Component;
  let warned = false;
  return function SafeSlotComponent(props) {
    try {
      return Component(props);
    } catch (error) {
      if (!warned) {
        warned = true;
        warnWithCode(label, error);
      }
      return null;
    }
  };
}

/**
 * 为 slot 组件加 render 错误边界：子组件 render 抛错时只静默降级为 null，
 * 并向宿主留一条可定位 warn；React.Component 不可用时退化为原组件（不阻断启动）。
 */
function createSlotErrorBoundary(Component, code) {
  const label = code || 'E_COMPONENT';
  if (
    typeof Component !== 'function' ||
    typeof React === 'undefined' ||
    !React ||
    typeof React.Component !== 'function'
  ) {
    return Component;
  }
  class SlotErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
      this.warned = false;
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error) {
      if (!this.warned) {
        this.warned = true;
        warnWithCode(label, error);
      }
    }
    render() {
      try {
        if (this.state && this.state.failed) return null;
        return React.createElement(Component, this.props);
      } catch (error) {
        if (!this.warned) {
          this.warned = true;
          warnWithCode(label, error);
        }
        return null;
      }
    }
  }
  return SlotErrorBoundary;
}
// @chat-avatars-boundary:end

function slotsOf(ctx) {
  try {
    if (ctx && ctx.slots) return ctx.slots;
  } catch (error) {}
  try {
    if (ctx && typeof ctx.get === 'function') return ctx.get('slots') || null;
  } catch (error) {}
  return null;
}

/** 注册设置页；slots 服务缺失/异常只降级（设置页不出现）。 */
function registerSettingsSlot(ctx) {
  const slots = slotsOf(ctx);
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    warnWithCode('E_SLOTS', makeError('slots service unavailable'));
    return;
  }
  registerEffect(
    ctx,
    function () {
      return slots.inject(CONTRACT.slots.settings, function () {
        return slots.register(
          {
            name: CONTRACT.slots.settings,
            id: 'chat-avatars',
            order: 12,
            label: function () {
              return t('title');
            }
          },
          createSlotErrorBoundary(createSafeSlotComponent(SettingsSection, 'E_COMPONENT'), 'E_COMPONENT')
        );
      });
    },
    'chat-avatars: settings'
  );
}

/** 注册会话桥；slots 服务缺失/异常只降级（不写变量 = 原生界面）。 */
function registerBridgeSlot(ctx) {
  const slots = slotsOf(ctx);
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    warnWithCode('E_SLOTS', makeError('slots service unavailable'));
    return;
  }
  registerEffect(
    ctx,
    function () {
      return slots.inject(CONTRACT.slots.bridge, function () {
        return slots.register(
          {
            name: CONTRACT.slots.bridge,
            id: 'chat-avatars-context',
            order: 1000
          },
          createSlotErrorBoundary(createSafeSlotComponent(ChatAvatarsBridge, 'E_COMPONENT'), 'E_COMPONENT')
        );
      });
    },
    'chat-avatars: bridge'
  );
}

function initRuntime(ctx) {
  try {
    bindLocaleService(ctx);
  } catch (error) {
    warnWithCode('E_I18N', error);
  }
  try {
    const store = createStore();
    store.init();
  } catch (error) {
    warnWithCode('E_STORE', error);
  }
  registerStatusEffect(ctx);
  registerStyleEffect(ctx);
  registerStorageSyncEffect(ctx);
  registerLocaleEffect(ctx);
  runContractProbe();
  registerProbeEffect(ctx);
  registerBridgeSlot(ctx);
  registerSettingsSlot(ctx);
  // M7：插件卸载/禁用时关闭共享 WebAudio 上下文（best-effort，永不抛错）。
  registerEffect(
    ctx,
    function () {
      return function () {
        try {
          disposePokeAudio();
        } catch (error) {}
      };
    },
    'chat-avatars: poke-audio'
  );
  // M7 打磨：设置导航图标适配（best-effort；宿主 DOM 变化时静默回退齿轮，永不抛错）。
  registerEffect(ctx, installSettingsNavIcon, 'chat-avatars: settings-nav-icon');
}

function apply(ctx) {
  try {
    initRuntime(ctx);
  } catch (error) {
    // 启动安全红线：apply 永不向宿主抛错。
    warnWithCode('E_APPLY', error);
  }
}
