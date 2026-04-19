export type TradeSide = 'BUY' | 'SELL';
export type TradeSlot = 1 | 2 | 3;

export interface TimeWindow {
  id: number;
  accountId: number;
  side: TradeSide;
  slot: TradeSlot;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
}

/** 분(0~1439)을 HH:MM 문자열로 변환 */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** HH:MM 문자열을 분(0~1439)으로 변환. 파싱 실패 시 null 반환 */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
