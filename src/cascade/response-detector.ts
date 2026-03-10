import type { Page } from "playwright-core";
import { SELECTORS } from "./selectors";

/**
 * Agent 回复检测器。
 *
 * 策略（基于回复容器计数）：
 * Cascade 每条 Agent 回复对应一个 `.leading-relaxed.select-text` 容器。
 * 1. 注入消息前记录容器数量 (baseline)
 * 2. 等待新容器出现（数量 > baseline）
 * 3. 等待最新容器的文本稳定
 * 4. 提取最新容器的文本作为回复
 *
 * 这种方式不依赖面板完整文本长度，在长对话中也能可靠工作。
 */
export class ResponseDetector {
  private static readonly STABLE_ROUNDS = 3;
  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly CONTENT_APPEAR_TIMEOUT_MS = 60_000;

  /**
   * 记录当前可见回复容器数量（快照 baseline）。
   * 排除被隐藏的 thinking/reasoning 容器。
   */
  public async countResponses(page: Page): Promise<number> {
    const visible = await this.getVisibleContainers(page);
    return visible.length;
  }

  /**
   * 等待 Agent 回复稳定后返回新增文本。
   *
   * @param page      Playwright Page
   * @param baseline  注入消息前的回复容器数量
   * @param timeoutMs 整体超时
   */
  public async waitForStableResponse(
    page: Page,
    baseline: number,
    timeoutMs = 120_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    console.log(
      `[ResponseDetector] baseline=${baseline} 个容器, 等待新回复容器出现...`,
    );

    // --- 阶段 1: 等待新的回复容器出现 ---
    const appearDeadline = Math.min(
      Date.now() + ResponseDetector.CONTENT_APPEAR_TIMEOUT_MS,
      deadline,
    );

    let newContainerFound = false;
    while (Date.now() < appearDeadline) {
      const currentCount = await this.countResponses(page);
      if (currentCount > baseline) {
        console.log(
          `[ResponseDetector] 检测到新回复容器 (${baseline} → ${currentCount})`,
        );
        newContainerFound = true;
        break;
      }

      // 也检查 loading 状态 — 如果 Agent 已开始处理但容器尚未出现，继续等待
      // Agent 正在思考/处理时不做特殊处理，继续等待即可

      await this.sleep(ResponseDetector.POLL_INTERVAL_MS);
    }

    if (!newContainerFound) {
      // 最后检查一次 — 可能内容出现在已有容器中（追加）
      const lastText = await this.getLastResponseText(page);
      if (lastText.length > 0) {
        console.log(
          `[ResponseDetector] 未检测到新容器，但最后容器有内容 (${lastText.length} chars)`,
        );
        // 继续到阶段 2 等待稳定
      } else {
        throw new Error(
          `Agent 回复超时 (${Math.round(
            ResponseDetector.CONTENT_APPEAR_TIMEOUT_MS / 1000,
          )}s)，未检测到新回复容器`,
        );
      }
    }

    // --- 阶段 2: 等待最新容器的文本稳定 ---
    let lastText = "";
    let stableCount = 0;

    console.log(`[ResponseDetector] 开始稳定性检测...`);

    while (Date.now() < deadline) {
      const currentText = await this.getLastResponseText(page);

      if (currentText === lastText && currentText.length > 0) {
        // 还要检查 Agent 是否仍在忙碌（思考/生成中）
        const busy = await this.isAgentBusy(page);
        if (busy) {
          // Agent 仍在处理，重置稳定计数
          stableCount = 0;
        } else {
          stableCount++;
          if (stableCount >= ResponseDetector.STABLE_ROUNDS) {
            console.log(
              `[ResponseDetector] 回复稳定 (${currentText.length} chars)`,
            );
            return currentText;
          }
        }
      } else {
        if (currentText !== lastText) {
          console.log(
            `[ResponseDetector] 内容变化 (${currentText.length} chars)`,
          );
        }
        stableCount = 0;
        lastText = currentText;
      }

      await this.sleep(ResponseDetector.POLL_INTERVAL_MS);
    }

    // 超时但有内容
    if (lastText.length > 0) {
      console.log(`[ResponseDetector] 超时但有内容 (${lastText.length} chars)`);
      return lastText;
    }

    throw new Error(
      `Agent 回复超时 (${Math.round(timeoutMs / 1000)}s)，未检测到新内容`,
    );
  }

  /**
   * 获取所有可见的回复容器（排除隐藏的 thinking/reasoning 容器）。
   *
   * Antigravity 的 thinking 容器通过祖先元素的 `max-h-0 opacity-0` 隐藏，
   * 但仍然被 `.leading-relaxed.select-text` 选择器匹配到。
   * 必须过滤掉，否则会把思维链文本发送到 Telegram。
   */
  private async getVisibleContainers(page: Page) {
    const all = await page.$$(SELECTORS.RESPONSE_CONTAINER);
    const visible = [];
    for (const container of all) {
      const isHidden = await container.evaluate((el: HTMLElement) => {
        let cur: HTMLElement | null = el;
        while (cur) {
          const cls = cur.className?.toString() ?? "";
          if (cls.includes("max-h-0") && cls.includes("opacity-0")) {
            return true;
          }
          cur = cur.parentElement;
        }
        return false;
      });
      if (!isHidden) {
        visible.push(container);
      }
    }
    return visible;
  }

  /**
   * 获取最后一个可见回复容器的纯文本。
   *
   * - 排除隐藏的 thinking 容器
   * - 排除内嵌 <style> 标签（Antigravity 注入的 alert CSS）
   */
  public async getLastResponseText(page: Page): Promise<string> {
    const visible = await this.getVisibleContainers(page);
    if (visible.length > 0) {
      const last = visible[visible.length - 1];
      const text = await last.evaluate((el: HTMLElement) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("style").forEach((s) => s.remove());
        return (clone.textContent ?? "").trim();
      });
      return text;
    }
    return "";
  }

  /**
   * 检测 Agent 是否正在加载（思考/生成中）。
   *
   * 仅在匹配的元素确实可见时才判定为忙碌，
   * 避免已折叠的 "Thought for X seconds" 区域导致误判。
   */
  public async isAgentBusy(page: Page): Promise<boolean> {
    for (const sel of SELECTORS.LOADING_INDICATORS) {
      const els = await page.$$(sel);
      for (const el of els) {
        const isVisible = await el.evaluate((e: HTMLElement) => {
          // 检查自身或祖先是否被隐藏
          let cur: HTMLElement | null = e;
          while (cur) {
            const cls = cur.className?.toString() ?? "";
            // Antigravity 隐藏模式：max-h-0 + opacity-0
            if (cls.includes("max-h-0") || cls.includes("opacity-0")) {
              return false;
            }
            const style = window.getComputedStyle(cur);
            if (style.display === "none" || style.visibility === "hidden") {
              return false;
            }
            cur = cur.parentElement;
          }
          return true;
        });
        if (isVisible) {
          return true;
        }
      }
    }
    return false;
  }

  /** 诊断工具 */
  public async debugSelectors(page: Page): Promise<void> {
    const candidates = [
      SELECTORS.INPUT,
      SELECTORS.PANEL,
      SELECTORS.RESPONSE_CONTAINER,
      SELECTORS.MESSAGE_BLOCK,
    ];

    for (const sel of candidates) {
      const els = await page.$$(sel).catch(() => []);
      console.log(`[ResponseDetector] ${sel}: ${els.length} 个`);
    }

    const count = await this.countResponses(page);
    console.log(`[ResponseDetector] 回复容器总数: ${count}`);

    const lastText = await this.getLastResponseText(page);
    console.log(`[ResponseDetector] 最新容器文本长度: ${lastText.length}`);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
