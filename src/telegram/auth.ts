export function isAllowedUser(userId: number, allowList: number[]): boolean {
  if (allowList.length === 0) {
    return false;
  }
  return allowList.includes(userId);
}
