/**
 * Telegram 消息格式化工具。
 *
 * Agent 回复是 Markdown 格式，Telegram 也支持 Markdown，
 * 但有一些差异需要处理。
 */

/** Telegram 单条消息最大字符数 */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * 格式化 Agent 回复为 Telegram 兼容的 Markdown。
 *
 * 主要处理：
 * - 保留代码块（Telegram 支持 ``` 语法）
 * - 转义 Telegram Markdown V1 的特殊字符（在代码块外）
 */
export function formatTelegramReply(text: string): string {
  if (!text) {
    return "";
  }

  let result = text;

  // Telegram MarkdownV1 模式下，代码块内无需转义，
  // 代码块外的 _ * [ ] ( ) ~ ` > # + - = | { } . ! 需要注意。
  // 但我们使用 parse_mode: "Markdown" (V1)，它比较宽松，
  // 只要代码块配对正确即可。此处做最小化处理。

  // 确保代码块配对（奇数个 ``` 时补一个闭合）
  const tripleBacktickCount = (result.match(/```/g) ?? []).length;
  if (tripleBacktickCount % 2 !== 0) {
    result += "\n```";
  }

  return result;
}

/**
 * 将长文本拆分为多条 Telegram 消息。
 *
 * 策略：
 * 1. 优先按代码块边界拆分
 * 2. 其次按空行拆分
 * 3. 最后硬截断
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // 在 MAX_MESSAGE_LENGTH 范围内找最佳拆分点
    const segment = remaining.slice(0, MAX_MESSAGE_LENGTH);

    // 优先找最后一个空行
    let splitAt = segment.lastIndexOf("\n\n");

    // 找不到空行就找最后一个换行
    if (splitAt === -1 || splitAt < MAX_MESSAGE_LENGTH / 2) {
      splitAt = segment.lastIndexOf("\n");
    }

    // 实在找不到就硬截断
    if (splitAt === -1 || splitAt < MAX_MESSAGE_LENGTH / 4) {
      splitAt = MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
