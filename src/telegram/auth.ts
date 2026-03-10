/**
 * 用户白名单鉴权。
 *
 * 安全策略：白名单为空时拒绝所有用户（而非允许所有）。
 * 这确保了即使用户忘记配置白名单，Bot 也不会响应陌生人。
 */
export function isAllowedUser(userId: number, allowList: number[]): boolean {
  if (allowList.length === 0) {
    return false;
  }
  return allowList.includes(userId);
}
