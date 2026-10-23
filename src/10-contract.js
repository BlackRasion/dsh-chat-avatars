/**
 * @module 10-contract
 * 职责：集中所有宿主契约——包名、槽位名、DOM 属性、CSS 变量名、样式节点标识、已验证 dsh 版本与支持区间。
 * 依赖：无（只放常量；不访问 DOM/存储/网络）。
 * 被依赖：其余所有模块只读本模块；宿主升级时优先只改这里。
 * 状态：M1-2 补齐样式节点标识与全部 CSS 变量；运行时契约探针的驱动逻辑在 bridge/status（M1-3/M1-5）。
 */
const PACKAGE_NAME = 'dsh-chat-avatars';

const CONTRACT = Object.freeze({
  packageName: PACKAGE_NAME,
  // 样式节点 identity：data-plugin 用包名（宿主 removeOwnedStyles 兜底清理），data-plugin-css 用于幂等复用。
  cssId: PACKAGE_NAME + '/runtime.css',
  slots: Object.freeze({
    // 常驻 session header 的 list 槽：隐藏桥组件挂在这里，避免 composer 变体导致卸载。
    bridge: 'conversation.session.header.utilities',
    // 设置页整页槽。
    settings: 'settings.section'
  }),
  attrs: Object.freeze({
    flowKind: 'data-chat-flow-kind',
    flowKey: 'data-chat-flow-key',
    conversationSession: 'data-conversation-session',
    // M5-5：推理轨迹分组/运行态（宿主 ChatFlow / ReasoningRow 根节点属性）。
    turn: 'data-chat-turn',
    groupPart: 'data-chat-group-part',
    processState: 'data-state',
    streaming: 'data-streaming',
    turnProcessHidden: 'data-turn-process-hidden',
    // M5：动图播放状态写在会话内容根；清理/暂停/静态头像时移除。
    animUser: 'data-dsh-av-anim-user',
    animAssistant: 'data-dsh-av-anim-assistant',
    // M7：拍一拍抖动标记（写在被点行上；animationend/超时移除）。
    poke: 'data-dsh-av-poke',
    // M7 打磨：设置导航「聊天头像」按钮标记（best-effort 图标适配；宿主 DOM 变化时不生效）。
    settingsNav: 'data-dsh-av-nav'
  }),
  kinds: Object.freeze({
    user: 'user',
    steering: 'steering',
    assistant: 'assistant-step'
  }),
  sides: Object.freeze(['user', 'assistant']),
  // 桥（M1-3）写入会话内容根的变量；全部缺失时 CSS 惰性、等价原生界面。
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
    // M5 动图：帧数 + animation shorthand（静态侧写 '1' / 'none'）。
    userFrames: '--dsh-av-user-frames',
    assistantFrames: '--dsh-av-assistant-frames',
    userAnim: '--dsh-av-user-anim',
    assistantAnim: '--dsh-av-assistant-anim',
    radius: '--dsh-av-radius'
  }),
  testedDsh: Object.freeze(['0.2.1-rc.2']),
  supportedRange: '>=0.2.1-rc.2 <0.3.0',
  // 版本门禁下界（与 supportedRange 一致）；运行时只接受 0.2.x。
  minDsh: '0.2.1-rc.2',
  // 宿主注入的 boot graph 全局名；release.version/commit 由 M1-5 读取。
  bootGlobal: '__DSH_BOOT__',
  build: '0.1.2'
});
