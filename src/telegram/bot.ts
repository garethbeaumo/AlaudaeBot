import { formatTelegramReply } from "./formatter";

export type MessageHandler = (text: string) => Promise<string>;

export class TelegramBridge {
  private running = false;
  private handler: MessageHandler | undefined;

  public constructor(
    private readonly token: string,
    private readonly allowedUsers: number[]
  ) {}

  public async start(): Promise<void> {
    if (!this.token.trim()) {
      throw new Error("Telegram bot token is empty");
    }
    this.running = true;
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  public async simulateIncomingMessage(text: string): Promise<string> {
    if (!this.running) {
      throw new Error("Telegram bridge is not running");
    }
    if (!this.handler) {
      throw new Error("Message handler is not registered");
    }
    const response = await this.handler(text);
    return formatTelegramReply(response);
  }

  public getAllowedUsers(): readonly number[] {
    return this.allowedUsers;
  }
}
