/**
 * @module 20-i18n
 * 职责：运行时中英文案；通过 ctx.locale 读取当前语言并注册字典，可降级为内置英文。
 * 依赖：contract（包名）。
 * 被依赖：storage / image / crop / settings / bridge / apply。
 * 状态：M1-4 迁移 0.1.0 完整设置页文案与 locale 注册；设置页 navigation label 用 thunk。
 */
const I18N_NS = 'chat-avatars';

// @chat-avatars-i18n:start
const DICT = Object.freeze({
  en: Object.freeze({
    title: 'Chat avatars',
    'default.user': 'You',
    'default.assistant': 'DS',
    enabled: 'Show avatars',
    appearance: 'Appearance',
    size: 'Size',
    shape: 'Shape',
    circle: 'Circle',
    rounded: 'Rounded',
    visibility: 'Visibility',
    showUser: 'User messages',
    showAssistant: 'AI messages',
    globalDefaults: 'Global defaults',
    'global.hint': 'Used by every workspace that does not override it.',
    'slot.user': 'User avatar',
    'slot.assistant': 'AI avatar',
    upload: 'Upload',
    replace: 'Replace',
    clear: 'Clear',
    restoreInherit: 'Restore inherit',
    workspaceOverrides: 'Workspaces',
    'workspace.hint': 'Each workspace can override the global defaults.',
    'workspace.empty': 'No workspaces yet.',
    'workspace.current': 'Current',
    inherited: 'Inheriting global',
    customized: 'Customized',
    dataTools: 'Data',
    exportBackup: 'Export backup',
    importBackup: 'Import backup',
    cleanOrphans: 'Remove unused workspace avatars',
    confirmOrphans: 'Click again to remove unused workspace avatars',
    clearAll: 'Clear all avatar data',
    confirmClear: 'Click again to clear everything',
    diagnostics: 'Diagnostics',
    copyDiagnostics: 'Copy diagnostics',
    retryProbe: 'Re-check',
    overrideProbe: 'Try anyway',
    restoreAutoProbe: 'Back to automatic',
    'crop.title': 'Crop avatar',
    'crop.stage': 'Crop area. Drag to reposition, arrow keys to move.',
    'crop.preview': 'Preview',
    'crop.hint': 'Drag to reposition; scroll or use the slider to zoom. Arrow keys move, Enter applies, Esc cancels.',
    'crop.zoom': 'Zoom',
    'crop.zoomIn': 'Zoom in',
    'crop.zoomOut': 'Zoom out',
    'crop.reset': 'Reset',
    'crop.cancel': 'Cancel',
    'crop.apply': 'Apply',
    'crop.scopeWorkspace': 'Applies to this workspace as an override.',
    'crop.scopeGlobal': 'Applies to all workspaces.',
    'crop.animatedHint': 'Animated image: this crop is applied to every frame.',
    animatedTag: 'Animated',
    'busy.upload': 'Uploading and processing…',
    'busy.processingAnim': 'Processing animation…',
    'busy.export': 'Exporting…',
    'busy.import': 'Importing…',
    'interaction.hint': 'Tip: single-click an avatar to preview it; use the preview to change it.',
    aiAvatarMode: 'AI avatar mode',
    'aiMode.everyStep': 'Every AI message',
    'aiMode.firstPerTurn': 'Once per turn (experimental)',
    'aiMode.hint': 'Once per turn is experimental; it is only recommended after long-conversation performance validation.',
    'interaction.card': 'Interaction',
    'poke.enabled': 'Poke (double-click avatars)',
    'poke.textsUser': 'Poke texts · user side',
    'poke.textsAssistant': 'Poke texts · AI side',
    'poke.defaultUser': 'You poked yourself',
    'poke.defaultUser2': 'You gave yourself a gentle poke',
    'poke.defaultUser3': 'You patted yourself on the head',
    'poke.defaultAssistant': 'You poked DS',
    'poke.defaultAssistant2': 'You gave DS a little poke',
    'poke.defaultAssistant3': 'You patted DS on the shoulder',
    'poke.textsHint': 'Random on every poke, no immediate repeat. Empty = built-in. Max 8 texts × 40 chars.',
    'poke.addText': 'Add text',
    'poke.removeText': 'Remove text',
    'poke.textLimit': 'Up to 8 texts per side.',
    'poke.sound': 'Poke sound',
    'poke.volume': 'Volume',
    'poke.test': 'Test sound',
    'poke.hint': 'Double-click an avatar in the chat for a local poke (bubble + sound).',
    'preview.title': 'Avatar preview',
    'preview.close': 'Close',
    'preview.change': 'Change avatar',
    'preview.poke': 'Poke',
    'preview.scopeWorkspace': 'Workspace override',
    'preview.scopeGlobal': 'Global default',
    'preview.scopeDefault': 'Built-in default',
    'import.confirm': 'Replace all avatar data with this backup?\n\nImages: {images}, workspaces: {workspaces}',
    'banner.contract': 'Chat message structure was not recognized. Avatars are paused to protect the layout.',
    'banner.unsupported': 'This dsh version is outside the supported range. Avatars are paused.',
    'banner.unverified': 'This dsh version has not been verified with this plugin yet.',
    'banner.storage': 'Browser storage is unavailable. Changes apply only until the page reloads.',
    'banner.readonly': 'Stored data comes from a newer plugin version; editing is disabled.',
    'banner.writeError': 'Saving failed.',
    'banner.badData': 'Stored avatar data was invalid and has been reset to defaults.',
    'banner.override': 'Avatars are forced on for this page session.',
    'notice.uploaded': 'Avatar saved.',
    'notice.cleared': 'All avatar data cleared.',
    'notice.imported': 'Backup imported.',
    'notice.exported': 'Backup exported.',
    'notice.orphans': 'Unused avatar data removed.',
    'notice.orphansUnavailable': 'Workspace list is unavailable; nothing was removed.',
    'notice.copied': 'Diagnostics copied.',
    'error.type': 'Only PNG / JPEG / WebP / GIF are supported.',
    'error.size': 'Static images must be 2 MB or smaller (animated images 6 MB).',
    'error.dimensions': 'Image resolution is too large.',
    'error.decode': 'This image could not be decoded.',
    'error.encode': 'This browser could not encode the image.',
    'error.tooLarge': 'The processed image is too large; try a simpler image.',
    'error.animUnsupported': 'This environment cannot process animated images (a secure context and ImageDecoder are required). Open the GUI via http://127.0.0.1 or upload a static image.',
    'error.quota': 'Local storage is full. Remove unused avatars and try again.',
    'error.storage': 'Browser storage is unavailable.',
    'error.import': 'This file is not a valid avatar backup.',
    'error.readonly': 'Stored data comes from a newer plugin version; editing is disabled.',
    'error.generic': 'Something went wrong.'
  }),
  zh: Object.freeze({
    title: '聊天头像',
    'default.user': 'You',
    'default.assistant': 'DS',
    enabled: '启用头像',
    appearance: '外观',
    size: '尺寸',
    shape: '形状',
    circle: '圆形',
    rounded: '圆角方形',
    visibility: '显示范围',
    showUser: '用户消息',
    showAssistant: 'AI 消息',
    globalDefaults: '全局默认',
    'global.hint': '未单独配置的工作区都使用这里的头像。',
    'slot.user': '用户头像',
    'slot.assistant': 'AI 头像',
    upload: '上传',
    replace: '替换',
    clear: '清除',
    restoreInherit: '恢复继承',
    workspaceOverrides: '工作区',
    'workspace.hint': '每个工作区都可以覆盖全局默认。',
    'workspace.empty': '还没有工作区。',
    'workspace.current': '当前',
    inherited: '继承全局',
    customized: '已自定义',
    dataTools: '数据',
    exportBackup: '导出备份',
    importBackup: '导入备份',
    cleanOrphans: '清理未使用的工作区头像',
    confirmOrphans: '再点一次确认清理未使用的工作区头像',
    clearAll: '清除全部头像数据',
    confirmClear: '再点一次确认清除',
    diagnostics: '诊断',
    copyDiagnostics: '复制诊断',
    retryProbe: '重新检测',
    overrideProbe: '仍要尝试',
    restoreAutoProbe: '恢复自动检测',
    'crop.title': '裁剪头像',
    'crop.stage': '裁剪区域，拖拽调整位置，方向键移动。',
    'crop.preview': '预览',
    'crop.hint': '拖拽调整位置；滚轮或滑块缩放；方向键移动，Enter 应用，Esc 取消。',
    'crop.zoom': '缩放',
    'crop.zoomIn': '放大',
    'crop.zoomOut': '缩小',
    'crop.reset': '重置',
    'crop.cancel': '取消',
    'crop.apply': '应用',
    'crop.scopeWorkspace': '保存为当前工作区的覆盖设置。',
    'crop.scopeGlobal': '应用于所有工作区。',
    'crop.animatedHint': '动图：裁剪会应用到所有帧。',
    animatedTag: '动图',
    'busy.upload': '上传并处理中…',
    'busy.processingAnim': '处理动图中…',
    'busy.export': '导出中…',
    'busy.import': '导入中…',
    'interaction.hint': '提示：单击聊天里的头像可查看大图，在预览里更换。',
    aiAvatarMode: 'AI 头像粒度',
    'aiMode.everyStep': '每条 AI 消息',
    'aiMode.firstPerTurn': '每回合一次（实验）',
    'aiMode.hint': '「每回合一次」为实验项；长会话性能验证通过前不建议使用。',
    'interaction.card': '互动',
    'poke.enabled': '拍一拍（双击头像）',
    'poke.textsUser': '拍一拍文案 · 用户侧',
    'poke.textsAssistant': '拍一拍文案 · AI 侧',
    'poke.defaultUser': '你拍了拍自己',
    'poke.defaultUser2': '你轻轻拍了拍自己',
    'poke.defaultUser3': '你拍了拍自己的头',
    'poke.defaultAssistant': '你拍了拍 DS',
    'poke.defaultAssistant2': '你戳了戳 DS',
    'poke.defaultAssistant3': '你拍了拍 DS 的肩膀',
    'poke.textsHint': '每次双击随机一条、不连续重复；留空用内置文案。最多 8 条 × 40 字。',
    'poke.addText': '添加文案',
    'poke.removeText': '删除文案',
    'poke.textLimit': '每侧最多 8 条。',
    'poke.sound': '拍一拍音效',
    'poke.volume': '音量',
    'poke.test': '试听',
    'poke.hint': '双击聊天里的头像触发本地拍一拍（气泡 + 音效）。',
    'preview.title': '头像大图',
    'preview.close': '关闭',
    'preview.change': '更换头像',
    'preview.poke': '拍一拍',
    'preview.scopeWorkspace': '工作区覆盖',
    'preview.scopeGlobal': '全局默认',
    'preview.scopeDefault': '内置默认',
    'import.confirm': '用这个备份替换全部头像数据？\n\n图片：{images}，工作区：{workspaces}',
    'banner.contract': '未识别聊天消息结构，已暂停头像以保护布局。',
    'banner.unsupported': '当前 dsh 版本超出支持范围，已暂停头像。',
    'banner.unverified': '当前 dsh 版本尚未与本插件验证。',
    'banner.storage': '浏览器存储不可用，修改仅在当前页面刷新前生效。',
    'banner.readonly': '本地数据来自更新版本的插件，暂不可编辑。',
    'banner.writeError': '保存失败。',
    'banner.badData': '本地头像数据无效，已重置为默认值。',
    'banner.override': '本页面已强制启用头像。',
    'notice.uploaded': '头像已保存。',
    'notice.cleared': '已清除全部头像数据。',
    'notice.imported': '备份已导入。',
    'notice.exported': '备份已导出。',
    'notice.orphans': '已清理未使用的头像数据。',
    'notice.orphansUnavailable': '工作区列表不可用，未执行清理。',
    'notice.copied': '诊断信息已复制。',
    'error.type': '仅支持 PNG / JPEG / WebP / GIF。',
    'error.size': '静态图片不能超过 2 MB，动图不能超过 6 MB。',
    'error.dimensions': '图片分辨率过高。',
    'error.decode': '图片无法解析，请换一张。',
    'error.encode': '浏览器无法编码这张图片。',
    'error.tooLarge': '处理后的图片仍然过大，请换一张更简单的图片。',
    'error.animUnsupported': '当前环境无法处理动图（需要安全上下文与 ImageDecoder）。请通过 http://127.0.0.1 打开界面，或上传静态图片。',
    'error.quota': '本地存储已满，请先清理未使用的头像。',
    'error.storage': '浏览器存储不可用。',
    'error.import': '这个文件不是有效的头像备份。',
    'error.readonly': '本地数据来自更新版本的插件，暂不可编辑。',
    'error.generic': '操作失败。'
  })
});
// @chat-avatars-i18n:end

// @chat-avatars-i18n-runtime:start
let localeCtx = null;
let localeService = null;
let localeRegistrationWanted = false;
let localeRegisteredService = null;
let localeDisposers = [];

/** 延迟解析宿主 locale 服务：桌面端可能晚于插件加载，不能在 init 时只取一次。 */
function resolveLocaleService() {
  if (localeService) return localeService;
  if (!localeCtx || typeof localeCtx.get !== 'function') return null;
  try {
    const service = localeCtx.get('locale');
    if (service) {
      localeService = service;
      ensureLocaleDictionaries();
    }
  } catch (error) {
    localeService = null;
  }
  return localeService;
}

/** 服务就绪后补注册中英字典；已注册过同一服务则跳过。 */
function ensureLocaleDictionaries() {
  if (!localeRegistrationWanted || !localeService || typeof localeService.register !== 'function') return;
  if (localeRegisteredService === localeService) return;
  localeRegisteredService = localeService;
  localeDisposers = [];
  for (const id of ['en', 'zh']) {
    try {
      const dispose = localeService.register(I18N_NS, id, DICT[id]);
      if (typeof dispose === 'function') localeDisposers.push(dispose);
    } catch (error) {}
  }
}

/** apply 时绑定 ctx；真正读取时再惰性解析 locale 服务。 */
function bindLocaleService(ctx) {
  localeCtx = ctx && typeof ctx.get === 'function' ? ctx : null;
  localeService = null;
  return resolveLocaleService();
}

/** 服务永远不可用时的浏览器语言兜底（html lang 优先，其次 navigator.languages）。 */
function readBrowserLocaleId() {
  try {
    const tags = [];
    if (typeof document !== 'undefined' && document && document.documentElement) {
      if (typeof document.documentElement.lang === 'string') tags.push(document.documentElement.lang);
    }
    if (typeof navigator !== 'undefined' && navigator) {
      if (Array.isArray(navigator.languages)) tags.push.apply(tags, navigator.languages);
      if (typeof navigator.language === 'string') tags.push(navigator.language);
    }
    for (const tag of tags) {
      const id = String(tag).toLowerCase();
      if (id.indexOf('zh') === 0) return 'zh';
      if (id.indexOf('en') === 0) return 'en';
    }
  } catch (error) {}
  return 'en';
}

/** 读取当前 locale id（LocaleSnapshot.active，0.2.1-rc.2 已核实）；服务缺失时回退浏览器语言。 */
function readLocaleId() {
  try {
    const service = resolveLocaleService();
    if (service) {
      const snapshot = typeof service.getLocale === 'function' ? service.getLocale() : null;
      const id =
        snapshot && typeof snapshot.active === 'string'
          ? snapshot.active
          : snapshot && typeof snapshot.id === 'string'
            ? snapshot.id
            : null;
      if (id) return id;
    }
  } catch (error) {}
  return readBrowserLocaleId();
}

/** 订阅 locale 变化；服务晚到时短轮询等待一次订阅机会，卸载时清理。 */
function subscribeLocaleChanges(callback) {
  let disposed = false;
  let disposeSubscription = null;
  let timer = 0;
  const attach = function () {
    if (disposed) return;
    const service = resolveLocaleService();
    if (service && typeof service.subscribe === 'function') {
      try {
        disposeSubscription = service.subscribe(function () {
          if (!disposed) callback();
        });
      } catch (error) {}
    }
    if (!disposeSubscription) timer = setTimeout(attach, 500);
  };
  attach();
  return function () {
    disposed = true;
    if (timer) {
      try {
        clearTimeout(timer);
      } catch (error) {}
      timer = 0;
    }
    if (typeof disposeSubscription === 'function') {
      try {
        disposeSubscription();
      } catch (error) {}
      disposeSubscription = null;
    }
  };
}

function currentLocaleId() {
  return readLocaleId();
}

/** 按 key 查当前语言字典，缺失回退 en / key 本身。 */
function t(key) {
  try {
    const id = String(readLocaleId()).toLowerCase();
    const dict = id.indexOf('zh') === 0 ? DICT.zh : DICT.en;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  } catch (error) {}
  return Object.prototype.hasOwnProperty.call(DICT.en, key) ? DICT.en[key] : String(key);
}

const ERROR_MESSAGE_KEYS = Object.freeze({
  E_TYPE: 'error.type',
  E_SIZE: 'error.size',
  E_DIMENSIONS: 'error.dimensions',
  E_DECODE: 'error.decode',
  E_ENCODE: 'error.encode',
  E_ANIM_UNSUPPORTED: 'error.animUnsupported',
  E_TOO_LARGE: 'error.tooLarge',
  E_STORAGE_QUOTA: 'error.quota',
  E_STORAGE_UNAVAILABLE: 'error.storage',
  E_IMPORT_INVALID: 'error.import',
  E_NEWER_SCHEMA: 'error.readonly'
});

function messageForCode(code) {
  return t(ERROR_MESSAGE_KEYS[code] || 'error.generic');
}
// @chat-avatars-i18n-runtime:end

/** 在 apply 的 effect 内调用：向宿主 locale 注册中英字典；服务晚到时在首次读取时补注册。 */
function registerLocaleDictionaries() {
  localeRegistrationWanted = true;
  try {
    ensureLocaleDictionaries();
  } catch (error) {
    warnWithCode('E_LOCALE', error);
  }
  return function () {
    localeRegistrationWanted = false;
    const disposers = localeDisposers;
    localeDisposers = [];
    localeRegisteredService = null;
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {}
    }
  };
}

/** locale 变化时触发重渲染（设置页/桥用它刷新文案）；服务晚到也能补订阅。 */
function useLocaleId() {
  const initial = React.useState(readLocaleId);
  const id = initial[0];
  const setId = initial[1];
  React.useEffect(function () {
    return subscribeLocaleChanges(function () {
      setId(readLocaleId());
    });
  }, []);
  return id;
}
