/**
 * @module 70-styles
 * 职责：样式表字符串 + 注入/清理（data-plugin 标记，幂等复用节点，effect 清理，宿主 removeOwnedStyles 兜底）。
 * 依赖：contract（包名/cssId）、status（warn）。
 * 被依赖：bridge / crop / settings / apply。
 * 状态：M1-2 已迁移 0.1.0 已验证 CSS（伪元素、token 渐变/分侧墨色、520/640 容器查询、设置页样式）。
 *
 * 启动安全：注入/清理都 try/catch，任何 DOM 不可用/异常都降级为 no-op，并向宿主只留一条 warn。
 */
const CSS_ID = CONTRACT.cssId;

// 仅使用 data-chat-flow-kind / data-* 契约选择器，不依赖宿主哈希类名。
// 全部变量默认值均为「不显示」：桥未挂载/暂停/变量缺失时规则完全惰性 = 原生界面。
const CSS_TEXT = [
  ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *) {',
  '  position: relative;',
  '  box-sizing: border-box;',
  '  padding-right: calc((var(--dsh-av-user-size, 0px) + 8px) * var(--dsh-av-user-show, 0));',
  '}',
  '[data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *) {',
  '  position: relative;',
  '  box-sizing: border-box;',
  '  padding-left: calc((var(--dsh-av-assistant-size, 0px) + 8px) * var(--dsh-av-assistant-show, 0));',
  '}',
  ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *)::after,',
  '[data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *)::before {',
  '  position: absolute;',
  '  top: 2px;',
  '  content: var(--dsh-av-label, "");',
  '  width: var(--dsh-av-size, 0px);',
  '  height: var(--dsh-av-size, 0px);',
  '  display: var(--dsh-av-display, none);',
  '  align-items: center;',
  '  justify-content: center;',
  '  overflow: hidden;',
  '  border-radius: var(--dsh-av-radius, 999px);',
  '  background-position: var(--dsh-av-bg-pos, center);',
  '  background-size: var(--dsh-av-bg-size, cover);',
  '  background-repeat: no-repeat;',
  '  box-shadow: 0 0 0 1px var(--dsw-alias-border-l1);',
  '  font-family: var(--dsw-font-family, system-ui, sans-serif);',
  '  font-weight: 600;',
  '  font-size: calc(var(--dsh-av-size, 0px) * 0.34);',
  '  line-height: 1;',
  '  color: var(--dsh-av-ink, #fff);',
  '  pointer-events: none;',
  '  user-select: none;',
  '}',
  ':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])::after {',
  '  --dsh-av-size: var(--dsh-av-user-size, 0px);',
  '  --dsh-av-display: var(--dsh-av-user-display, none);',
  '  --dsh-av-label: var(--dsh-av-user-label, "");',
  '  right: 0;',
  '  --dsh-av-ink: var(--dsw-alias-bg-base);',
  '  background-color: var(--dsw-alias-brand-primary);',
  '  background-image: var(--dsh-av-user-image, none), linear-gradient(135deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .12));',
  '  animation: var(--dsh-av-user-anim, none);',
  '}',
  '[data-chat-flow-kind="assistant-step"]::before {',
  '  --dsh-av-size: var(--dsh-av-assistant-size, 0px);',
  '  --dsh-av-display: var(--dsh-av-assistant-display, none);',
  '  --dsh-av-label: var(--dsh-av-assistant-label, "");',
  '  left: 0;',
  '  --dsh-av-ink: var(--dsw-alias-label-primary);',
  '  background-color: var(--dsw-alias-bg-layer-2);',
  '  background-image: var(--dsh-av-assistant-image, none), linear-gradient(135deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .08));',
  '  animation: var(--dsh-av-assistant-anim, none);',
  '}',
  // M5 动图：根属性存在时用雪碧图（auto 100%）代替 cover 静态图，并用 steps() 横向播放。
  // 注意：覆盖规则必须带与基础规则同样的 :not([hidden]):not([hidden] *) 过滤，否则会被基础规则盖掉。
  '[data-dsh-av-anim-user="1"] :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *)::after {',
  '  --dsh-av-bg-pos: 0 0;',
  '  --dsh-av-bg-size: auto 100%;',
  '  background-image: var(--dsh-av-user-image, none);',
  '}',
  '[data-dsh-av-anim-assistant="1"] [data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *)::before {',
  '  --dsh-av-bg-pos: 0 0;',
  '  --dsh-av-bg-size: auto 100%;',
  '  background-image: var(--dsh-av-assistant-image, none);',
  '}',
  '@keyframes dsh-av-play-user { from { background-position-x: 0; } to { background-position-x: calc(-1 * var(--dsh-av-size, 0px) * var(--dsh-av-user-frames, 1)); } }',
  '@keyframes dsh-av-play-assistant { from { background-position-x: 0; } to { background-position-x: calc(-1 * var(--dsh-av-size, 0px) * var(--dsh-av-assistant-frames, 1)); } }',
  // reduced-motion：冻结首帧（停止动画、background-position 回 0），不改变静态头像。
  '@media (prefers-reduced-motion: reduce) {',
  '  [data-dsh-av-anim-user="1"] :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *)::after { animation: none; background-position: 0 0; }',
  '  [data-dsh-av-anim-assistant="1"] [data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *)::before { animation: none; background-position: 0 0; }',
  '}',
  // M4-2：first-per-turn 模式只保留带标记的 assistant 行头像；无标记行不占 padding、不显示伪元素。
  '[data-dsh-av-ai-mode="first-per-turn"] [data-chat-flow-kind="assistant-step"]:not([data-dsh-av-mark="assistant"]):not([hidden]):not([hidden] *) { padding-left: 0; }',
  '[data-dsh-av-ai-mode="first-per-turn"] [data-chat-flow-kind="assistant-step"]:not([data-dsh-av-mark="assistant"]):not([hidden]):not([hidden] *)::before { display: none; }',
  // M5-5：推理/思考行默认不显示头像；仅「正在流式思考」的行显示 20px 活动头像。
  // 宿主 ReasoningRow 根节点 running 时带 data-state="running"（后备 data-streaming），完成后变 ok；
  // 纯 CSS :has 自动切换，无 observer、不撑行（20px 适配 24px 思考行）。
  '[data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]:not([hidden]):not([hidden] *)::before { display: none; }',
  '[data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *)::before { display: var(--dsh-av-assistant-display, none); top: 2px; left: calc(var(--dsh-av-size, 0px) - 16px); right: auto; width: 20px; height: 20px; font-size: 7px; border-radius: 999px; animation: none; background-position: 0 0; }',
  // M5-5：过程展开后的成员行（data-turn-process-member）只是过程信息，不显示持久头像；
  // 最终 response 行没有该属性（可能带 data-turn-process-answer），继续保留配置尺寸头像。
  // 特异性低于「正在思考」活动头像规则，因此 running 推理行仍显示 20px 活动头像。
  '[data-chat-flow-kind="assistant-step"][data-turn-process-member]:not([hidden]):not([hidden] *)::before { display: none; }',
  // M5-5：过程成员行收紧为紧凑时间线：头像隐藏时左缩进归零。
  '[data-chat-flow-kind="assistant-step"][data-turn-process-member]:not([hidden]):not([hidden] *) { padding-left: 0; }',
  // 成员行里「正在思考」的推理行：给 20px 活动头像留 26px 紧凑槽位（头像贴最左、文字紧随）。
  '[data-chat-flow-kind="assistant-step"][data-turn-process-member][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *) { padding-left: 26px; }',
  '[data-chat-flow-kind="assistant-step"][data-turn-process-member][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *)::before { display: var(--dsh-av-assistant-display, none); top: 2px; left: 0; right: auto; width: 20px; height: 20px; font-size: 7px; border-radius: 999px; animation: none; background-position: 0 0; }',
  // 注意：基础行规则带 :not([hidden]):not([hidden] *) 过滤，特异性更高；
  // 容器查询里覆盖 padding / display / 尺寸的规则必须带同样的 :not 过滤，否则会被基础规则盖掉
  // （M1-8 真机验收发现：窄屏 hide 与 padding 归零曾因此失效）。
  '@container (max-width: 519px) {',
  '  :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *) { padding-right: 0; }',
  '  [data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *) { padding-left: 0; }',
  '  :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *)::after,',
  '  [data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *)::before { display: none; }',
  '  [data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *)::before { display: none; }',
  '  [data-chat-flow-kind="assistant-step"][data-turn-process-member][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *) { padding-left: 0; }',
  '  [data-chat-flow-kind="assistant-step"][data-turn-process-member][data-chat-group-part="reasoning"]:has([data-state="running"], [data-streaming]):not([data-dsh-av-ai-mode="first-per-turn"] *):not([hidden]):not([hidden] *)::before { display: none; }',
  '}',
  '@container (min-width: 520px) and (max-width: 639px) {',
  '  :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):not([hidden]):not([hidden] *) { --dsh-av-user-size: 28px; }',
  '  [data-chat-flow-kind="assistant-step"]:not([hidden]):not([hidden] *) { --dsh-av-assistant-size: 28px; }',
  '}',
  '.dsh-av-settings { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }',
  '.dsh-av-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; background: var(--dsw-alias-bg-layer-1); }',
  '.dsh-av-card-body { display: flex; flex-direction: column; gap: 10px; }',
  '.dsh-av-card-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }',
  '.dsh-av-card-head:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: 6px; }',
  '.dsh-av-card-count { font-size: 11px; line-height: 1; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 18%, transparent); color: var(--dsw-alias-label-secondary); }',
  '.dsh-av-card-chevron { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary); transition: transform .18s ease; }',
  '.dsh-av-card.is-collapsed .dsh-av-card-chevron { transform: rotate(-90deg); }',
  // M7 打磨：设置导航「聊天头像」图标（best-effort：宿主外壳按 section id 硬编码图标、未知回退齿轮；
  // 85-settings-nav-icon 在设置面板出现时给目标按钮打 [data-dsh-av-nav]，这里隐藏齿轮并绘制自定义图标）。
  '[data-dsh-av-nav] > svg { display: none !important; }',
  '[data-dsh-av-nav]::before { content: ""; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%221.3%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M13.4%208.1c0%202.5-2.4%204.5-5.4%204.5-.6%200-1.2-.1-1.7-.2L3.1%2013.9l.6-2.4C2.7%2010.6%202.2%209.5%202.2%208.1c0-2.5%202.4-4.5%205.4-4.5s5.8%202%205.8%204.5Z%22%2F%3E%3Ccircle%20cx%3D%227.6%22%20cy%3D%227.1%22%20r%3D%221.35%22%2F%3E%3Cpath%20d%3D%22M5.4%2010.4c.3-1%201.1-1.6%202.2-1.6s1.9.6%202.2%201.6%22%2F%3E%3C%2Fsvg%3E") center / 16px 16px no-repeat; mask: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%20stroke%3D%22%23fff%22%20stroke-width%3D%221.3%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M13.4%208.1c0%202.5-2.4%204.5-5.4%204.5-.6%200-1.2-.1-1.7-.2L3.1%2013.9l.6-2.4C2.7%2010.6%202.2%209.5%202.2%208.1c0-2.5%202.4-4.5%205.4-4.5s5.8%202%205.8%204.5Z%22%2F%3E%3Ccircle%20cx%3D%227.6%22%20cy%3D%227.1%22%20r%3D%221.35%22%2F%3E%3Cpath%20d%3D%22M5.4%2010.4c.3-1%201.1-1.6%202.2-1.6s1.9.6%202.2%201.6%22%2F%3E%3C%2Fsvg%3E") center / 16px 16px no-repeat; }',
  '.dsh-av-card-title { font-weight: 600; font-size: 13px; }',
  '.dsh-av-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
  '.dsh-av-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; }',
  '.dsh-av-row-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; max-width: 62%; }',
  '.dsh-av-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }',
  '.dsh-av-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '.dsh-av-btn:focus-visible, .dsh-av-switch:focus-visible, .dsh-av-select:focus-visible, .dsh-av-slider:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }',
  '.dsh-av-btn-danger { color: var(--dsw-alias-state-error-primary); }',
  '.dsh-av-switch { width: 34px; height: 20px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); position: relative; cursor: pointer; padding: 0; }',
  '.dsh-av-switch.is-on { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }',
  '.dsh-av-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, .25); }',
  '.dsh-av-switch.is-on .dsh-av-switch-knob { transform: translateX(14px); }',
  '.dsh-av-select { font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 3px 8px; }',
  '.dsh-av-slider-row { display: flex; align-items: center; gap: 10px; width: min(280px, 100%); }',
  '.dsh-av-slider { flex: 1 1 auto; min-width: 120px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }',
  '.dsh-av-slider-value { min-width: 44px; text-align: right; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }',
  '.dsh-av-slot { display: flex; align-items: center; gap: 12px; padding: 6px 0; }',
  '.dsh-av-preview { flex: none; width: 32px; height: 32px; border-radius: 999px; background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 11px; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1); overflow: hidden; }',
  '.dsh-av-tag-weak { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-secondary); vertical-align: 1px; }',
  '.dsh-av-tag-weak::before { content: "·"; margin-right: 4px; }',
  '.dsh-av-slot-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
  '.dsh-av-slot-label { font-size: 12px; }',
  '.dsh-av-slot-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
  '.dsh-av-ws { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }',
  '.dsh-av-ws.is-current { border-color: var(--dsw-alias-brand-primary); }',
  '.dsh-av-ws-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
  '.dsh-av-ws-title { font-weight: 600; display: flex; align-items: center; gap: 6px; }',
  '.dsh-av-ws-status { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-left: auto; }',
  '.dsh-av-tag { font-size: 11px; font-weight: 400; color: var(--dsw-alias-brand-primary); border: 1px solid var(--dsw-alias-brand-primary); border-radius: 999px; padding: 0 6px; }',
  '.dsh-av-banner { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-2); }',
  '.dsh-av-banner-list { display: flex; flex-direction: column; gap: 4px; }',
  '.dsh-av-banner-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
  '.dsh-av-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
  '.dsh-av-notice { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; font-size: 12px; }',
  '.dsh-av-notice-error { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }',
  '.dsh-av-diag summary { cursor: pointer; }',
  '.dsh-av-pre { margin: 8px 0; max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.45; background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 8px; white-space: pre-wrap; word-break: break-word; color: var(--dsw-alias-label-secondary); }',
  '.dsh-av-crop-dialog { box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); width: min(92vw, 560px); max-height: 90vh; overflow: auto; box-shadow: 0 18px 48px rgba(0, 0, 0, .35); }',
  '.dsh-av-crop-dialog::backdrop { background: rgba(0, 0, 0, .45); }',
  '.dsh-av-crop-head { font-weight: 600; font-size: 14px; margin-bottom: 12px; }',
  '.dsh-av-crop-scope { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary); margin: -6px 0 10px; }',
  '[data-chat-flow-kind][' + 'data-dsh-av-hover]::after, [data-chat-flow-kind][' + 'data-dsh-av-hover]::before { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color); }',
  '.dsh-av-crop-body { display: flex; gap: 16px; align-items: flex-start; }',
  '.dsh-av-crop-stage { position: relative; flex: 1 1 280px; min-width: 200px; max-width: 320px; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); cursor: grab; touch-action: none; outline: none; }',
  '.dsh-av-crop-stage:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }',
  '.dsh-av-crop-stage:active { cursor: grabbing; }',
  '.dsh-av-crop-canvas { display: block; width: 100%; height: 100%; pointer-events: none; }',
  '.dsh-av-crop-side { display: flex; flex-direction: column; gap: 8px; align-items: center; min-width: 96px; }',
  '.dsh-av-crop-preview-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
  '.dsh-av-crop-preview { width: 64px; height: 64px; display: block; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1); }',
  '.dsh-av-crop-preview.is-rounded { border-radius: 18px; }',
  '.dsh-av-crop-hint { font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary); max-width: 140px; }',
  '.dsh-av-crop-zoom { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px; font-size: 12px; }',
  '.dsh-av-crop-zoom input { flex: 1; accent-color: var(--dsw-alias-brand-primary); }',
  '.dsh-av-crop-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }',
  '.dsh-av-crop-spacer { flex: 1; }',
  '.dsh-av-btn-primary { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 22%, var(--dsw-alias-bg-layer-2, #2a2a32)); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 58%, transparent); color: var(--dsw-alias-label-primary, #fff); }',
  '.dsh-av-btn-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 32%, var(--dsw-alias-bg-layer-2, #2a2a32)); }',
  '@media (max-width: 520px) { .dsh-av-crop-body { flex-direction: column; } .dsh-av-crop-stage { flex: none; width: 100%; height: auto; max-width: none; aspect-ratio: 1 / 1; } .dsh-av-crop-side { flex-direction: row; align-items: center; } .dsh-av-crop-hint { max-width: none; } }',
  // M7：头像大图预览（原生 dialog top-layer）
  '.dsh-av-preview-dialog { border: 0; padding: 0; background: transparent; color: var(--dsw-alias-label-primary, #fff); max-width: calc(100vw - 32px); margin: 10vh auto auto; }',
  '.dsh-av-preview-dialog::backdrop { background: rgba(0, 0, 0, .55); backdrop-filter: blur(10px); }',
  '.dsh-av-preview-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 24px 18px; min-width: 260px; border-radius: 18px; background: var(--dsw-alias-bg-layer-2, #1f1f24); border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .12)); box-shadow: 0 20px 56px rgba(0, 0, 0, .40); animation: dsh-av-preview-in 220ms cubic-bezier(.2, .9, .3, 1.15); }',
  '.dsh-av-preview-stage { position: relative; display: flex; align-items: center; justify-content: center; }',
  '.dsh-av-preview-avatar { background-repeat: no-repeat; box-shadow: 0 0 0 1px var(--dsw-alias-border-l1, rgba(255, 255, 255, .12)), 0 12px 32px rgba(0, 0, 0, .35); }',
  '.dsh-av-preview-avatar.is-poking { animation: dsh-av-poke-shake 520ms cubic-bezier(.2, .8, .3, 1) 1 !important; }',
  '.dsh-av-preview-name { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }',
  '.dsh-av-preview-scope { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
  '.dsh-av-preview-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }',
  // M7-11：桌面端浅色主题——实色卡片、轻阴影、浅色磨砂遮罩，避免圆角处叠出脏阴影。
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] { color-scheme: light; color: #111827; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"]::backdrop { background: rgba(250, 250, 252, .46); backdrop-filter: blur(14px) saturate(120%); }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-preview-card { background: #fff; color: #111827; border-color: rgba(15, 23, 42, .14); box-shadow: 0 10px 28px rgba(15, 23, 42, .12), 0 2px 6px rgba(15, 23, 42, .06); }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-preview-avatar { box-shadow: 0 0 0 1px rgba(15, 23, 42, .12), 0 8px 20px rgba(15, 23, 42, .12); }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-preview-name { color: #111827; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-preview-scope { color: #6b7280; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-btn { background: #fff; border-color: rgba(15, 23, 42, .16); color: #1f2937; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-btn:hover { background: #f3f4f6; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-btn-primary { background: #ede9fe; border-color: #c4b5fd; color: #4c1d95; }',
  '.dsh-av-preview-dialog[data-dsh-av-theme="light"] .dsh-av-btn-primary:hover { background: #e0d7fe; }',
  '.dsh-av-preview-poke-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; max-width: min(260px, 82%); padding: 7px 13px; border-radius: 14px; font-size: 13px; font-weight: 500; line-height: 1.4; color: var(--dsw-alias-label-primary, #fff); background: linear-gradient(140deg, color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 32%, var(--dsw-alias-bg-layer-2, #1f1f24)), color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 12%, var(--dsw-alias-bg-layer-2, #1f1f24))); border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 44%, transparent); box-shadow: 0 10px 24px rgba(0, 0, 0, .32), inset 0 1px 0 rgba(255, 255, 255, .16); animation: dsh-av-preview-chip-in 200ms cubic-bezier(.2, .9, .3, 1.15); }',
  '.dsh-av-preview-poke-chip::before { content: ""; position: absolute; left: 50%; top: -5px; width: 10px; height: 10px; border-radius: 2px; background: inherit; border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 44%, transparent); border-bottom-color: transparent; border-right-color: transparent; transform: translateX(-50%) rotate(45deg); }',
  '@keyframes dsh-av-preview-chip-in { from { opacity: 0; transform: translateY(-6px) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }',
  '.dsh-av-preview-poke-sparkle { font-size: 12px; line-height: 1; color: color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 55%, #fff); }',
  '@keyframes dsh-av-preview-play { from { background-position-x: 0; } to { background-position-x: calc(-1 * var(--dsh-av-preview-size, 208px) * var(--dsh-av-preview-frames, 1)); } }',
  '@keyframes dsh-av-preview-in { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }',
  // M7：拍一拍气泡——品牌渐变药丸 + 玻璃高光；横向与头像对齐、纵向优先头像上方
  '.dsh-av-poke-bubble { position: fixed; z-index: 2147483000; display: inline-flex; align-items: center; gap: 7px; max-width: min(300px, 74vw); padding: 9px 15px 9px 13px; border-radius: 16px; font-size: 13px; font-weight: 500; line-height: 1.45; letter-spacing: .01em; color: var(--dsw-alias-label-primary, #fff); background: linear-gradient(140deg, color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 34%, var(--dsw-alias-bg-layer-2, #1f1f24)), color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 12%, var(--dsw-alias-bg-layer-2, #1f1f24)) 58%, color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 24%, var(--dsw-alias-bg-layer-2, #1f1f24))); border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 46%, transparent); box-shadow: 0 12px 30px rgba(0, 0, 0, .38), inset 0 1px 0 rgba(255, 255, 255, .18), inset 0 0 0 1px rgba(255, 255, 255, .04); backdrop-filter: blur(18px) saturate(150%); pointer-events: none; opacity: 0; transform: translateY(5px) scale(.8); transform-origin: var(--dsh-av-poke-origin, 50% 100%); }',
  '.dsh-av-poke-bubble.is-above { --dsh-av-poke-origin: 50% 100%; }',
  '.dsh-av-poke-bubble.is-below { --dsh-av-poke-origin: 50% 0%; }',
  '.dsh-av-poke-bubble.is-placed { animation: dsh-av-poke-pop 300ms cubic-bezier(.2, .9, .3, 1.2) both, dsh-av-poke-fade 240ms ease 1.95s forwards; }',
  '.dsh-av-poke-sparkle { flex: none; font-size: 12px; line-height: 1; color: color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 55%, #fff); text-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 60%, transparent); animation: dsh-av-poke-twinkle 520ms ease-in-out 2; }',
  '.dsh-av-poke-bubble::after { content: ""; position: absolute; width: 12px; height: 12px; border-radius: 3px; background: inherit; border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #6d5efc) 46%, transparent); transform: rotate(45deg); left: calc(var(--dsh-av-poke-tail, 20px) - 7px); }',
  '.dsh-av-poke-bubble.is-above::after { bottom: -6px; border-top-color: transparent; border-left-color: transparent; }',
  '.dsh-av-poke-bubble.is-below::after { top: -6px; border-bottom-color: transparent; border-right-color: transparent; }',
  '@keyframes dsh-av-poke-pop { 0% { opacity: 0; transform: translateY(6px) scale(.78) rotate(-2deg); } 55% { opacity: 1; transform: translateY(-2px) scale(1.03) rotate(.6deg); } 100% { opacity: 1; transform: translateY(0) scale(1) rotate(0); } }',
  '@keyframes dsh-av-poke-fade { from { opacity: 1; } to { opacity: 0; transform: translateY(3px) scale(.98); } }',
  '@keyframes dsh-av-poke-twinkle { 0%, 100% { opacity: .55; transform: scale(.9) rotate(0); } 50% { opacity: 1; transform: scale(1.25) rotate(18deg); } }',
  // 头像周围的短促粒子
  '.dsh-av-poke-burst { position: fixed; z-index: 2147482999; width: 0; height: 0; pointer-events: none; }',
  '.dsh-av-poke-dot, .dsh-av-poke-spark { position: absolute; left: 0; top: 0; border-radius: 50%; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 62%, #fff); box-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 70%, transparent); animation: dsh-av-poke-dot 560ms cubic-bezier(.16, .84, .34, 1) forwards; }',
  '.dsh-av-poke-dot { width: 5px; height: 5px; }',
  '.dsh-av-poke-spark { width: 7px; height: 7px; border-radius: 2px; }',
  '.dsh-av-poke-dot.is-1 { --dsh-av-poke-dx: -20px; --dsh-av-poke-dy: -16px; }',
  '.dsh-av-poke-dot.is-2 { --dsh-av-poke-dx: 18px; --dsh-av-poke-dy: -20px; }',
  '.dsh-av-poke-dot.is-3 { --dsh-av-poke-dx: 24px; --dsh-av-poke-dy: 8px; }',
  '.dsh-av-poke-spark.is-4 { --dsh-av-poke-dx: -24px; --dsh-av-poke-dy: 12px; }',
  '@keyframes dsh-av-poke-dot { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(-50% + var(--dsh-av-poke-dx, 0px)), calc(-50% + var(--dsh-av-poke-dy, 0px))) scale(1); } }',
  '@keyframes dsh-av-poke-shake { 0%, 100% { transform: translateX(0) rotate(0deg) scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 52%, transparent); } 25% { transform: translateX(-3px) rotate(-6deg) scale(1.04); box-shadow: 0 0 0 5px color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 26%, transparent); } 55% { transform: translateX(3px) rotate(6deg) scale(1.04); box-shadow: 0 0 0 10px color-mix(in srgb, var(--dsw-alias-brand-primary, #8b7dff) 0%, transparent); } 80% { transform: translateX(-1px) rotate(-2deg) scale(1.01); } }',
  '[data-chat-flow-kind][data-dsh-av-poke="user"]:not([hidden]):not([hidden] *)::after, [data-chat-flow-kind][data-dsh-av-poke="assistant"]:not([hidden]):not([hidden] *)::before { animation: dsh-av-poke-shake 520ms cubic-bezier(.2, .8, .3, 1) 1; transform-origin: 50% 55%; }',
  // M7：设置页「互动」输入（宽度受控，不超出卡片右缘）
  '.dsh-av-text { width: 100%; min-width: 0; max-width: 240px; box-sizing: border-box; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: inherit; font-size: 13px; }',
  '.dsh-av-text:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 1px; }',
  // M7-10：随机文案组列表（每行输入 + 删除，下方添加入口）。
  '.dsh-av-poke-texts { display: flex; flex-direction: column; gap: 6px; min-width: 0; width: 100%; max-width: 300px; }',
  '.dsh-av-poke-text-row { display: flex; align-items: center; gap: 6px; }',
  '.dsh-av-poke-text-row .dsh-av-text { flex: 1; max-width: none; }',
  '.dsh-av-btn-mini { padding: 4px 8px; font-size: 12px; }',
  '.dsh-av-actions-inline { display: flex; gap: 8px; margin-top: 4px; }',
  '@media (prefers-reduced-motion: reduce) { .dsh-av-preview-card, .dsh-av-preview-poke-chip { animation: none; } .dsh-av-poke-bubble { animation: none !important; opacity: 1; transform: none; } .dsh-av-poke-burst { display: none; } .dsh-av-poke-sparkle, .dsh-av-preview-poke-sparkle { animation: none; } .dsh-av-preview-avatar.is-animated { animation: none !important; background-position: 0 0; } [data-chat-flow-kind][data-dsh-av-poke]::after, [data-chat-flow-kind][data-dsh-av-poke]::before { animation: none !important; } .dsh-av-preview-avatar.is-poking { animation: none !important; } }'
].join('\n');

function findStyleElement() {
  try {
    if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return null;
    return document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']');
  } catch (error) {
    return null;
  }
}

/** 幂等注入样式：已有同 data-plugin-css 节点则复用；返回清理函数（删除节点）。 */
function installStyleSheet() {
  try {
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
      return function () {};
    }
    let element = findStyleElement();
    if (element === null) {
      element = document.createElement('style');
      element.dataset.plugin = PACKAGE_NAME;
      element.dataset.pluginCss = CSS_ID;
      const parent = document.head || document.documentElement;
      if (!parent || typeof parent.appendChild !== 'function') throw makeError('E_STYLE');
      parent.appendChild(element);
    }
    element.textContent = CSS_TEXT;
    return function () {
      try {
        if (element) element.remove();
      } catch (error) {
        warnWithCode('E_STYLE', error);
      }
    };
  } catch (error) {
    // 样式不可用只影响外观，绝不阻断启动。
    warnWithCode('E_STYLE', error);
    return function () {};
  }
}

/** 清理路径兜底（宿主 removeOwnedStyles 也会按 data-plugin 清理）。 */
function removeStyleSheet() {
  const element = findStyleElement();
  if (element === null) return false;
  try {
    element.remove();
    return true;
  } catch (error) {
    warnWithCode('E_STYLE', error);
    return false;
  }
}
