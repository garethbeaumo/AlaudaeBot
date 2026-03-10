/**
 * Cascade 聊天面板 DOM 选择器。
 *
 * 基于 2026-03 版本 Antigravity 的实际 DOM 结构。
 */
export const SELECTORS = {
  /** Cascade 侧边面板的根容器 */
  PANEL: ".antigravity-agent-side-panel",

  /** 输入框 (contenteditable div) */
  INPUT: ".antigravity-agent-side-panel div[contenteditable]",

  /** Agent 回复文本块 — 每段回复对应一个 p 标签（或其他块级元素）
   *  父容器 class 含 'leading-relaxed select-text' */
  RESPONSE_CONTAINER:
    ".antigravity-agent-side-panel .leading-relaxed.select-text",

  /** 滚动区域下的顶层消息区域 */
  MESSAGE_BLOCK:
    ".antigravity-agent-side-panel [class*='message-block']",

  /** Agent 回复中的 p / pre / li 等块级元素 */
  RESPONSE_BLOCKS: ".antigravity-agent-side-panel .leading-relaxed.select-text p, .antigravity-agent-side-panel .leading-relaxed.select-text pre, .antigravity-agent-side-panel .leading-relaxed.select-text li",

  /** 加载/忙碌指示器 */
  LOADING_INDICATORS: [
    ".antigravity-agent-side-panel [class*='loading']",
    ".antigravity-agent-side-panel [class*='spinner']",
    ".antigravity-agent-side-panel [class*='thinking']",
    ".antigravity-agent-side-panel [class*='Thought']",
  ],
} as const;
