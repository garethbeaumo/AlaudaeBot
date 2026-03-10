import { CascadeController, type PageSelector } from "../cascade/controller";
import { TelegramBridge } from "../telegram/bot";
import { BridgeState, StateChangeListener } from "../types";
import { MessageQueue } from "./queue";

/**
 * 核心桥接逻辑：Telegram ↔ Cascade。
 *
 * 状态机:
 *   offline → connecting → online ⇄ busy
 *                ↑           ↓
 *                └── reconnecting
 */
export class AlaudaeBridge {
  private readonly queue = new MessageQueue();
  private draining = false;
  private state: BridgeState = "offline";
  private stateListener: StateChangeListener | undefined;

  /**
   * 同步互斥标志，防止两条消息同时进入 sendAndWaitReply。
   * 在 Node 单线程模型中，只要在 await 之前设置即可防止竞态。
   */
  private processing = false;

  /** 重连相关 */
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private static readonly RECONNECT_DELAYS_MS = [2000, 5000, 10000, 30000];
  private reconnectAttempt = 0;
  private stopping = false;

  /** 多窗口页面选择回调（由 UI 层提供） */
  private pageSelector: PageSelector | undefined;

  public constructor(
    private readonly cascade: CascadeController,
    private readonly telegram: TelegramBridge
  ) {}

  /** 注册状态变更监听 (状态栏更新用) */
  public onStateChange(listener: StateChangeListener): void {
    this.stateListener = listener;
  }

  /** 注册多窗口页面选择回调 */
  public setPageSelector(selector: PageSelector): void {
    this.pageSelector = selector;
  }

  public getState(): BridgeState {
    return this.state;
  }

  public getQueuedCount(): number {
    return this.queue.size;
  }

  // ─── 启动 / 停止 ─────────────────────────────────────

  public async start(): Promise<void> {
    this.stopping = false;
    this.reconnectAttempt = 0;
    await this.connectAndRun();
  }

  public async stop(): Promise<void> {
    this.stopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    await this.telegram.stop();
    await this.cascade.disconnect();

    this.setState("offline");
  }

  // ─── 对话管理 ────────────────────────────────────────

  /** 在 Cascade 面板中新建对话 */
  public async newChat(): Promise<void> {
    await this.cascade.newChat();
  }

  // ─── 核心连接流程 ─────────────────────────────────────

  private async connectAndRun(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.setState(
      this.reconnectAttempt > 0 ? "reconnecting" : "connecting"
    );

    try {
      // Step 1: 连接 CDP（首次连接时触发窗口选择，重连时自动选择）
      const selector =
        this.reconnectAttempt === 0 ? this.pageSelector : undefined;
      await this.cascade.connect(selector);

      // Step 2: 注册消息处理（携带 chatId 用于排队回复投递）
      this.telegram.onMessage(async (text, chatId) => {
        return this.handleIncomingMessage(text, chatId);
      });

      // Step 3: 启动 Telegram long polling
      await this.telegram.start();

      // 成功 → 重置重连计数
      this.reconnectAttempt = 0;
      this.setState("online");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AlaudaeBot] 连接失败: ${msg}`);

      // 用户取消选择 → 不重连，直接离线
      if (msg.includes("用户取消")) {
        this.setState("offline");
        return;
      }

      this.scheduleReconnect();
    }
  }

  // ─── 消息处理 ─────────────────────────────────────────

  private async handleIncomingMessage(
    text: string,
    chatId: number
  ): Promise<string> {
    // 同步互斥守卫 — 在任何 await 之前检查并设置，
    // Node 单线程模型保证此处不会竞态。
    if (this.processing) {
      this.queue.add({ text, chatId });
      this.setState("busy");
      return `⏳ Agent 忙碌中，消息已排队 (第 ${this.queue.size} 条)...`;
    }

    // 异步检查 Cascade 外部状态
    if (!(await this.cascade.isIdle())) {
      this.queue.add({ text, chatId });
      this.setState("busy");
      return `⏳ Agent 忙碌中，消息已排队 (第 ${this.queue.size} 条)...`;
    }

    // 锁定 — 在 await sendAndWaitReply 之前
    this.processing = true;
    this.setState("busy");

    try {
      const reply = await this.cascade.sendAndWaitReply(text);
      return reply;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // 如果是连接问题，触发重连
      if (this.isConnectionError(msg)) {
        this.queue.add({ text, chatId });
        this.scheduleReconnect();
        return `🔌 连接已断开，正在重连... 消息已排队。`;
      }

      return `❌ Agent 处理失败: ${msg}`;
    } finally {
      this.processing = false;
      // 回复完成后自动处理排队消息
      this.setState(this.queue.size > 0 ? "busy" : "online");
      void this.drainQueue();
    }
  }

  // ─── 排队消息处理 ─────────────────────────────────────

  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      let next = this.queue.next();
      while (next !== undefined && !this.stopping) {
        this.processing = true;
        try {
          const reply = await this.cascade.sendAndWaitReply(next.text);
          // 将回复通过 Telegram API 发送回对应聊天
          await this.telegram.sendToChat(next.chatId, reply);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 通知用户排队消息处理失败
          await this.telegram
            .sendToChat(next.chatId, `❌ 排队消息处理失败: ${msg}`)
            .catch(() => {});
        }
        this.processing = false;
        this.setState(this.queue.size > 0 ? "busy" : "online");
        next = this.queue.next();
      }
    } finally {
      this.draining = false;
      this.processing = false;
    }
  }

  // ─── 重连策略 ─────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.stopping) {
      return;
    }

    const delays = AlaudaeBridge.RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];

    console.log(
      `[AlaudaeBot] 将在 ${delay / 1000}s 后重连 (尝试 #${this.reconnectAttempt + 1})`
    );

    this.setState("reconnecting");

    // 先断开旧连接
    void this.cascade.disconnect().catch(() => {});

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempt++;
      await this.connectAndRun();
    }, delay);
  }

  private isConnectionError(message: string): boolean {
    const patterns = [
      "not connected",
      "target closed",
      "session closed",
      "connection refused",
      "ECONNREFUSED",
      "page crashed",
      "browser disconnected",
      "No page available",
    ];
    const lower = message.toLowerCase();
    return patterns.some((p) => lower.includes(p.toLowerCase()));
  }

  // ─── 状态管理 ─────────────────────────────────────────

  private setState(newState: BridgeState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListener?.(newState, this.queue.size);
    }
  }
}
