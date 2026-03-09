import { isAllowedUser } from "./auth";
import { formatTelegramReply } from "./formatter";

export type MessageHandler = (text: string) => Promise<string>;

export class TelegramBridge {
  private running = false;
  private handler: MessageHandler | undefined;

  public constructor(
    private readonly token: string,
    private readonly allowedUsers: number[]
  ) { }

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

  /** 检查用户是否有权限 */
  public checkAuth(userId: number): boolean {
    return isAllowedUser(userId, this.allowedUsers);
  }

  public async simulateIncomingMessage(text: string, userId: number): Promise<string> {
    if (!this.running) {
      throw new Error("Telegram bridge is not running");
    }
    if (!this.handler) {
      throw new Error("Message handler is not registered");
    }
    if (!this.checkAuth(userId)) {
      return "🚫 无权限：你的用户 ID 不在白名单中。";
    }
    const response = await this.handler(text);
    return formatTelegramReply(response);
  }

  public getAllowedUsers(): readonly number[] {
    return this.allowedUsers;
  }
}
