/**
 * @module 85-settings-nav-icon
 * 职责：M7 打磨——设置导航「聊天头像」图标适配（best-effort 宿主兼容层）。
 *   宿主设置外壳按 section id 硬编码导航图标（account/models/agent-presets/plugins/archived-sessions），
 *   未知 id 一律回退设置齿轮；`settings.section` 注册项没有 icon 扩展点。因此本模块在设置面板出现时
 *   给「聊天头像」导航按钮打 `data-dsh-av-nav` 标记，由 70-styles 隐藏宿主齿轮并用 mask 绘制自定义图标。
 * 依赖：contract（attrs.settingsNav）/ i18n（t）/ status（warnWithCode）。
 * 被依赖：apply（registerEffect 安装/清理）。
 * 边界：非公开宿主契约，dsh 升级导致 DOM/文案变化时静默不生效（回退宿主齿轮），任何路径都不向宿主抛错。
 */

const SETTINGS_NAV_ATTR = CONTRACT.attrs.settingsNav;
const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]';
const SETTINGS_NAV_CELL_SELECTOR = 'button[class*="navCell"]';
const SETTINGS_NAV_RETRY_MAX = 6;

// @chat-avatars-nav-icon:start
/** 在设置面板内按 label 文案找到目标导航按钮（便于单测提取；找不到返回 null）。 */
function findSettingsNavButton(panel, label) {
  try {
    if (!panel || typeof panel.querySelectorAll !== 'function') return null;
    if (typeof label !== 'string' || !label) return null;
    const buttons = panel.querySelectorAll(SETTINGS_NAV_CELL_SELECTOR);
    const target = String(label).trim();
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      if (!button || !button.textContent) continue;
      if (String(button.textContent).trim() === target) return button;
    }
    return null;
  } catch (error) {
    return null;
  }
}
// @chat-avatars-nav-icon:end

/** 找到设置面板并为「聊天头像」导航按钮打标记；返回是否已标记。 */
function markSettingsNavIcon() {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return false;
    const panel = document.querySelector(SETTINGS_PANEL_SELECTOR);
    if (!panel) return false;
    const button = findSettingsNavButton(panel, typeof t === 'function' ? t('title') : '');
    if (!button) return false;
    if (button.getAttribute(SETTINGS_NAV_ATTR) !== '1') button.setAttribute(SETTINGS_NAV_ATTR, '1');
    return true;
  } catch (error) {
    warnWithCode('E_NAV_ICON', error);
    return false;
  }
}

/** 清除已打的标记（宿主节点可能已卸载，遍历 document 兜底）。 */
function clearSettingsNavIcon() {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelectorAll !== 'function') return;
    const nodes = document.querySelectorAll('[' + SETTINGS_NAV_ATTR + ']');
    for (let index = 0; index < nodes.length; index += 1) {
      try {
        nodes[index].removeAttribute(SETTINGS_NAV_ATTR);
      } catch (error) {}
    }
  } catch (error) {}
}

/**
 * 安装设置导航图标适配：监听 body 直接子节点变化（设置面板是 body 直接子节点，成本低），
 * rAF 合并后重新扫描；面板刚挂载时做有限次重试（等 React 渲染完导航）。
 * 返回清理函数：断开 observer、取消定时器、移除标记。
 */
function installSettingsNavIcon() {
  const noop = function () {};
  try {
    if (typeof document === 'undefined' || !document || typeof document.body === 'undefined') return noop;
    if (typeof MutationObserver !== 'function') return noop;
    let disposed = false;
    let frame = 0;
    let retryTimer = 0;
    let retries = 0;
    const panelExists = function () {
      try {
        return !!(document.querySelector && document.querySelector(SETTINGS_PANEL_SELECTOR));
      } catch (error) {
        return false;
      }
    };
    const schedule = function () {
      try {
        if (disposed) return;
        if (typeof requestAnimationFrame !== 'function') {
          markSettingsNavIcon();
          return;
        }
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          if (disposed) return;
          const marked = markSettingsNavIcon();
          if (!marked && panelExists() && retries < SETTINGS_NAV_RETRY_MAX) {
            retries += 1;
            retryTimer = setTimeout(schedule, 140);
          } else if (marked) {
            retries = 0;
          }
        });
      } catch (error) {}
    };
    let observer = null;
    try {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true });
    } catch (error) {
      try {
        if (observer) observer.disconnect();
      } catch (ignored) {}
      return noop;
    }
    markSettingsNavIcon();
    return function () {
      disposed = true;
      try {
        if (frame) cancelAnimationFrame(frame);
      } catch (error) {}
      try {
        if (retryTimer) clearTimeout(retryTimer);
      } catch (error) {}
      try {
        if (observer) observer.disconnect();
      } catch (error) {}
      clearSettingsNavIcon();
    };
  } catch (error) {
    return noop;
  }
}
