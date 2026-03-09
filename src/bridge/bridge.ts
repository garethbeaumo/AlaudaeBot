import { CascadeController } from "../cascade/controller";
import { TelegramBridge } from "../telegram/bot";
import { MessageQueue } from "./queue";

export class AlaudaeBridge {
  private readonly queue = new MessageQueue();

  public constructor(
    private readonly cascade: CascadeController,
    private readonly telegram: TelegramBridge
  ) {}

  public async start(): Promise<void> {
    await this.cascade.connect();

    this.telegram.onMessage(async (text) => {
      if (!(await this.cascade.isIdle())) {
        this.queue.add(text);
        return "⏳ Agent 忙碌中，消息已排队...";
      }
      return this.cascade.sendAndWaitReply(text);
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
}
