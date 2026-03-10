import { chromium, type Browser, type Page } from "playwright-core";
import { SELECTORS } from "./selectors";
import { ResponseDetector } from "./response-detector";

/** 候选页面信息（传递给 UI 层让用户选择） */
export interface PageCandidate {
  /** 窗口标题，如 "projectTokyo - Antigravity - main.ts" */
  title: string;
  /** 已有的回复数量（表示对话活跃度） */
  responseCount: number;
}

/**
 * 页面选择回调。当 CDP 发现多个可用窗口时调用。
 * @param candidates 候选页面列表
 * @returns 用户选择的索引，-1 表示取消
 */
export type PageSelector = (
  candidates: PageCandidate[]
) => Promise<number>;

/**
 * 通过 Playwright CDP 连接 Antigravity (Electron) 窗口，
 * 操控 Cascade 聊天面板进行消息注入和回复捕获。
 */
export class CascadeController {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private connected = false;
  private busy = false;
  private readonly responseDetector = new ResponseDetector();

  /**
   * @param cdpUrl  CDP 端点 URL，例如 `http://127.0.0.1:9222`
   */
  public constructor(private readonly cdpUrl: string) {}

  // ─── 连接管理 ──────────────────────────────────────────

  /**
   * 通过 CDP 连接到 Antigravity 并定位 Cascade 面板。
   * @param pageSelector  多窗口时的选择回调（由 UI 层提供）。
   *                      如果省略，自动选择有最多对话内容的页面。
   */
  public async connect(pageSelector?: PageSelector): Promise<void> {
    if (this.connected) {
      return;
    }

    console.log(`[CascadeController] 连接 CDP: ${this.cdpUrl}`);
    this.browser = await chromium.connectOverCDP(this.cdpUrl);

    // 列出所有页面供调试
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        const title = await p.title().catch(() => "(无法获取)");
        console.log(`[CascadeController] 发现页面: ${title}`);
      }
    }

    // 找到包含 Cascade 输入框的页面
    this.page = await this.findCascadePage(pageSelector);

    // 连接成功，诊断一次 DOM 选择器
    await this.responseDetector.debugSelectors(this.page);

    this.connected = true;
    console.log("[CascadeController] CDP 连接成功");
  }

  /** 断开 CDP 连接，释放资源 */
  public async disconnect(): Promise<void> {
    this.page = undefined;
    this.busy = false;
    this.connected = false;

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = undefined;
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  // ─── 消息收发 ──────────────────────────────────────────

  /**
   * 向 Cascade 输入框注入消息并等待 Agent 回复。
   */
  public async sendAndWaitReply(
    message: string,
    timeoutMs = 120_000
  ): Promise<string> {
    if (!this.connected || !this.page) {
      throw new Error("CascadeController is not connected");
    }
    if (!message.trim()) {
      return "";
    }

    this.busy = true;
    console.log(`[CascadeController] 发送消息: "${message.substring(0, 50)}..."`);

    try {
      // Step 1: 记录回复容器 baseline
      const baseline = await this.responseDetector.countResponses(this.page);
      console.log(`[CascadeController] baseline=${baseline} 个回复容器`);

      // Step 2: 注入消息
      await this.injectMessage(message);
      console.log("[CascadeController] 消息已注入，等待回复...");

      // Step 3: 等待稳定回复
      const reply = await this.responseDetector.waitForStableResponse(
        this.page,
        baseline,
        timeoutMs
      );

      console.log(`[CascadeController] 收到回复 (${reply.length} chars)`);
      return reply;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CascadeController] 消息处理失败: ${errMsg}`);
      throw err;
    } finally {
      this.busy = false;
    }
  }

  // ─── 对话管理 ──────────────────────────────────────────

  /**
   * 在 Cascade 面板中新建对话。
   * 尝试查找并点击 "New Chat" 按钮，如果找不到则使用快捷键。
   */
  public async newChat(): Promise<void> {
    if (!this.connected || !this.page) {
      throw new Error("CascadeController is not connected");
    }

    console.log("[CascadeController] 新建对话...");

    // 方案 1: 查找新建对话按钮（多种可能的选择器）
    const newChatSelectors = [
      ".antigravity-agent-side-panel [aria-label*='new' i]",
      ".antigravity-agent-side-panel [aria-label*='New Chat' i]",
      ".antigravity-agent-side-panel [title*='new' i]",
      ".antigravity-agent-side-panel button:has([class*='plus'])",
      ".antigravity-agent-side-panel button:has([class*='add'])",
    ];

    for (const selector of newChatSelectors) {
      const btn = await this.page.$(selector);
      if (btn) {
        await btn.click();
        console.log(`[CascadeController] 点击了新建对话按钮: ${selector}`);
        await new Promise((r) => setTimeout(r, 500));
        return;
      }
    }

    // 方案 2: 使用 Ctrl+L 快捷键（Antigravity 新建对话的通用快捷键）
    console.log(
      "[CascadeController] 未找到新建对话按钮，使用 Ctrl+L 快捷键"
    );
    await this.page.keyboard.press("Control+l");
    await new Promise((r) => setTimeout(r, 500));
  }

  // ─── 空闲检测 ──────────────────────────────────────────

  public async isIdle(): Promise<boolean> {
    if (!this.connected || !this.page) {
      return false;
    }
    if (this.busy) {
      return false;
    }

    try {
      const agentBusy = await this.responseDetector.isAgentBusy(this.page);
      return !agentBusy;
    } catch {
      return false;
    }
  }

  public async waitUntilIdle(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isIdle()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Cascade agent is still busy");
  }

  // ─── 内部方法 ──────────────────────────────────────────

  /**
   * 在所有 CDP 页面中寻找 Cascade 聊天面板。
   *
   * 当发现多个候选窗口时：
   *   - 如果提供了 pageSelector 回调 → 让用户选择
   *   - 否则自动选择对话内容最多的页面
   */
  private async findCascadePage(
    pageSelector?: PageSelector
  ): Promise<Page> {
    if (!this.browser) {
      throw new Error("Browser not connected");
    }

    interface Candidate {
      page: Page;
      title: string;
      responseCount: number;
    }

    const candidates: Candidate[] = [];

    for (const ctx of this.browser.contexts()) {
      for (const page of ctx.pages()) {
        try {
          const title = await page.title().catch(() => "");
          const hasInput = await page.$(SELECTORS.INPUT);
          if (hasInput) {
            const responseCount = await page
              .$$(SELECTORS.RESPONSE_CONTAINER)
              .then((els) => els.length)
              .catch(() => 0);

            candidates.push({ page, title, responseCount });
            console.log(
              `[CascadeController] 候选页面: "${title}" (回复数=${responseCount})`
            );
          }
        } catch {
          // DevTools / 后台页面
        }
      }
    }

    // 没有候选 → fallback
    if (candidates.length === 0) {
      for (const ctx of this.browser.contexts()) {
        if (ctx.pages().length > 0) {
          const fallback = ctx.pages()[0];
          const title = await fallback.title().catch(() => "?");
          console.log(
            `[CascadeController] 未找到 Cascade 输入框，fallback: "${title}"`
          );
          return fallback;
        }
      }
      throw new Error(
        "未找到可用的 Antigravity 页面。请确认 Antigravity 正在运行且 CDP 端口正确。"
      );
    }

    // 只有一个 → 直接使用
    if (candidates.length === 1) {
      console.log(
        `[CascadeController] 唯一候选页面: "${candidates[0].title}"`
      );
      return candidates[0].page;
    }

    // 多个候选 → 让用户选择（如果有回调的话）
    if (pageSelector) {
      const uiCandidates: PageCandidate[] = candidates.map((c) => ({
        title: c.title,
        responseCount: c.responseCount,
      }));

      const selectedIndex = await pageSelector(uiCandidates);

      if (selectedIndex < 0 || selectedIndex >= candidates.length) {
        throw new Error("用户取消了窗口选择");
      }

      const chosen = candidates[selectedIndex];
      console.log(
        `[CascadeController] 用户选择了: "${chosen.title}"`
      );
      return chosen.page;
    }

    // 没有选择回调 → 自动选对话最多的
    candidates.sort((a, b) => b.responseCount - a.responseCount);
    const best = candidates[0];
    console.log(
      `[CascadeController] 自动选择: "${best.title}" (回复数=${best.responseCount})`
    );
    return best.page;
  }

  /**
   * 注入消息到 Cascade 输入框。
   */
  private async injectMessage(message: string): Promise<void> {
    if (!this.page) {
      throw new Error("No page available");
    }

    console.log(`[CascadeController] 等待输入框 (${SELECTORS.INPUT})...`);

    const inputBox = await this.page.waitForSelector(SELECTORS.INPUT, {
      timeout: 10_000,
    });

    if (!inputBox) {
      throw new Error(
        `找不到 Cascade 输入框 (${SELECTORS.INPUT})。请确认 Cascade 面板已打开。`
      );
    }

    console.log("[CascadeController] 找到输入框，开始输入...");

    // 聚焦输入框
    await inputBox.click();

    // 清空已有内容
    await this.page.keyboard.press("Control+a");
    await this.page.keyboard.press("Delete");

    // 使用 evaluate 直接设置 contenteditable 内容
    await this.page.evaluate(
      ({ sel, text }) => {
        const input = document.querySelector(sel) as HTMLElement;
        if (input) {
          input.textContent = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(input);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      },
      { sel: SELECTORS.INPUT, text: message }
    );

    await new Promise((r) => setTimeout(r, 200));

    // 按 Enter 提交
    await this.page.keyboard.press("Enter");
    console.log("[CascadeController] Enter 已按下");
  }
}
