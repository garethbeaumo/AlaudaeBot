export function formatTelegramReply(text: string): string {
  if (text.length <= 4096) {
    return text;
  }
  return `${text.slice(0, 4093)}...`;
}
