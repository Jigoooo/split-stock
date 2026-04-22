/**
 * 한국 정규장 기준 간단 세션 판정.
 * 휴장일/반일장은 고려하지 않고, 주중 09:00~15:30 KST만 정규장으로 본다.
 */
export function isRegularMarketOpenKst(now: Date = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}
