/**
 * KRX 거래일 판정 — broker-agnostic 폴백.
 *
 * 공식 한국거래소 휴장일은 매년 12월에 다음 해 일정이 발표된다. 본 모듈은
 * 정적 휴장일 리스트(국가법정공휴일 + 임시휴장일) + 주말 판정으로 broker
 * 미제공 환경(Kiwoom 등) 의 isTradingDay 폴백을 제공.
 *
 * 정확도: 매년 KRX 공식 발표(http://global.krx.co.kr/contents/GLB/05/0501/0501050202/
 * GLB0501050202.jsp) 기준 갱신. 기본값으로는 2025-2026 한국 법정공휴일을 포함.
 */

const HOLIDAYS_2025: ReadonlyArray<string> = [
  '2025-01-01', // 신정
  '2025-01-28', // 설 연휴
  '2025-01-29',
  '2025-01-30',
  '2025-03-03', // 삼일절 대체
  '2025-05-05', // 어린이날 (=석가탄신일 겹침)
  '2025-05-06', // 대체
  '2025-06-06', // 현충일
  '2025-08-15', // 광복절
  '2025-10-03', // 개천절
  '2025-10-06', // 추석 연휴
  '2025-10-07',
  '2025-10-08',
  '2025-10-09', // 한글날
  '2025-12-25', // 크리스마스
  '2025-12-31', // 연말 폐장
];

const HOLIDAYS_2026: ReadonlyArray<string> = [
  '2026-01-01',
  '2026-02-16', // 설 연휴
  '2026-02-17',
  '2026-02-18',
  '2026-03-02', // 삼일절 대체
  '2026-05-05',
  '2026-05-25', // 석가탄신일
  '2026-06-03', // 대선
  '2026-06-08', // 현충일 대체
  '2026-08-17', // 광복절 대체
  '2026-09-24', // 추석 연휴
  '2026-09-25',
  '2026-09-26',
  '2026-10-05', // 개천절 대체
  '2026-10-09',
  '2026-12-25',
  '2026-12-31',
];

const HOLIDAY_SET: ReadonlySet<string> = new Set([...HOLIDAYS_2025, ...HOLIDAYS_2026]);

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * KRX 거래일 여부 — 주말 + 휴장일 리스트 기반.
 *
 * @param date 판정 대상 날짜 (KST 기준)
 * @returns true=거래일, false=휴장일/주말
 */
export function isKrxTradingDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // 일/토
  return !HOLIDAY_SET.has(toIsoDate(date));
}
