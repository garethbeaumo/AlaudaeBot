export class ResponseDetector {
  public async waitForStableResponse(timeoutMs = 60000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await this.sleep(200);
      // Phase 1: 占位实现，后续接入真实 DOM 检测逻辑。
      return "[placeholder] response";
    }
    throw new Error("Timed out while waiting for Agent response");
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
