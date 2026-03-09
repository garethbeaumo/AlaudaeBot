import { ResponseDetector } from "./response-detector";

export class CascadeController {
  private connected = false;
  private busy = false;
  private readonly responseDetector = new ResponseDetector();

  public constructor(private readonly cdpUrl: string) { }

  public async connect(): Promise<void> {
    if (!this.cdpUrl.startsWith("http://") && !this.cdpUrl.startsWith("ws://")) {
      throw new Error(`Unsupported CDP url: ${this.cdpUrl}`);
    }
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.busy = false;
  }

  public async sendAndWaitReply(message: string): Promise<string> {
    if (!this.connected) {
      throw new Error("CascadeController is not connected");
    }
    if (!message.trim()) {
      return "";
    }
    this.busy = true;
    try {
      // 占位实现：后续接入真实 CDP 时，在此将 message 发送到 Agent 输入框
      return await this.responseDetector.waitForStableResponse();
    } finally {
      this.busy = false;
    }
  }

  /** 已连接且未在处理消息时为空闲 */
  public async isIdle(): Promise<boolean> {
    return this.connected && !this.busy;
  }

  public async waitUntilIdle(timeoutMs = 30000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.isIdle()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Cascade agent is still busy");
  }
}
