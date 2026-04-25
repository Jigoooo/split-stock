/**
 * 한국 정규장 기준 간단 세션 판정.
 * 휴장일/반일장은 고려하지 않고, 주중 09:00~15:30 KST만 정규장으로 본다.
 */
export function isRegularMarketOpenKst(now: Date = new Date()): boolean {
  return getRegularMarketSessionKst(now).isRegularOpen;
}

export interface RegularMarketSessionKst {
  date: string;
  day: number;
  isWeekend: boolean;
  isRegularHours: boolean;
  isRegularOpen: boolean;
  minutes: number;
}

export function getRegularMarketSessionKst(now: Date = new Date()): RegularMarketSessionKst {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const isWeekend = day === 0 || day === 6;
  const isRegularHours = minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
  return {
    date: `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(
      kst.getUTCDate(),
    ).padStart(2, '0')}`,
    day,
    isWeekend,
    isRegularHours,
    isRegularOpen: !isWeekend && isRegularHours,
    minutes,
  };
}
