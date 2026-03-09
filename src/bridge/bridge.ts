import { CascadeController } from "../cascade/controller";
import { TelegramBridge } from "../telegram/bot";
import { MessageQueue } from "./queue";

export class AlaudaeBridge {
  private readonly queue = new MessageQueue();
  private draining = false;

  public constructor(
    private readonly cascade: CascadeController,
    private readonly telegram: TelegramBridge
  ) { }

  public async start(): Promise<void> {
    await this.cascade.connect();

    this.telegram.onMessage(async (text) => {
      if (!(await this.cascade.isIdle())) {
        this.queue.add(text);
        return "⏳ Agent 忙碌中，消息已排队...";
      }
      try {
        const reply = await this.cascade.sendAndWaitReply(text);
        // 回复完成后，自动处理排队消息
        void this.drainQueue();
        return reply;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `❌ Agent 处理失败: ${msg}`;
      }
    });

    await this.telegram.start();
  }

  public async stop(): Promise<void> {
    await this.telegram.stop();
    await this.cascade.disconnect();
  }

  public getQueuedCount(): number {
    return this.queue.size;
  }

  /** 逐条消费排队消息，确保串行处理 */
  private async drainQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      let next = this.queue.next();
      while (next !== undefined) {
        try {
          await this.cascade.sendAndWaitReply(next);
        } catch {
          // 排队消息处理失败时跳过，继续处理下一条
        }
        next = this.queue.next();
      }
    } finally {
      this.draining = false;
    }
  }
}
