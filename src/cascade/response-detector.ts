export class ResponseDetector {
  /**
   * 等待 Agent 响应稳定后返回内容。
   *
   * 占位实现：直接返回示例文本。
   * 后续需接入真实 DOM 检测逻辑：
   *   1. 轮询页面 DOM 获取最新回复内容
   *   2. 比较相邻两次内容是否一致（稳定性窗口）
   *   3. 内容稳定后返回，超时则抛出错误
   */
  public async waitForStableResponse(_timeoutMs = 60000): Promise<string> {
    // TODO: 替换为真实的 DOM 轮询 + 增量检测逻辑
    await this.sleep(200);
    return "[placeholder] response";
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
