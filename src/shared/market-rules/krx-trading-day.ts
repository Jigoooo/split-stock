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
const HOLIDAY_REASON_BY_DATE: ReadonlyMap<string, string> = new Map([
  ...HOLIDAYS_2025.map((date) => [date, 'KRX_HOLIDAY'] as const),
  ...HOLIDAYS_2026.map((date) => [date, 'KRX_HOLIDAY'] as const),
  ['2025-12-31', 'YEAR_END_MARKET_CLOSING'] as const,
  ['2026-12-31', 'YEAR_END_MARKET_CLOSING'] as const,
]);

export const BUNDLED_KRX_CALENDAR_SOURCE_VERSION = '2026-static-20260430';
export const BUNDLED_KRX_CALENDAR_YEARS = [2025, 2026] as const;
export const KRX_REGULAR_OPEN_MINUTE = 9 * 60;
export const KRX_REGULAR_CLOSE_MINUTE = 15 * 60 + 30;

export interface BundledKrxCalendarDay {
  date: string; // YYYYMMDD
  openDay: boolean;
  openMinute: number | null;
  closeMinute: number | null;
  reason: string;
  sourceVersion: string;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yyyymmddToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toYyyymmdd(date: Date): string {
  return toIsoDate(date).replaceAll('-', '');
}

function parseYyyymmdd(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
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

/**
 * 앱 번들 KRX 캘린더 판정.
 *
 * 포함된 연도 범위를 벗어나면 null 을 반환한다. 호출자는 이 경우 UNKNOWN 으로
 * fail-closed 해야 한다.
 */
export function resolveBundledKrxTradingDay(date: Date | string): BundledKrxCalendarDay | null {
  const yyyymmdd = typeof date === 'string' ? date : toYyyymmdd(date);
  const parsed = typeof date === 'string' ? parseYyyymmdd(date) : date;
  if (!parsed) return null;
  const year = parsed.getFullYear();
  if (!BUNDLED_KRX_CALENDAR_YEARS.includes(year as (typeof BUNDLED_KRX_CALENDAR_YEARS)[number])) {
    return null;
  }

  const day = parsed.getDay();
  if (day === 0 || day === 6) {
    return {
      date: yyyymmdd,
      openDay: false,
      openMinute: null,
      closeMinute: null,
      reason: 'WEEKEND',
      sourceVersion: BUNDLED_KRX_CALENDAR_SOURCE_VERSION,
    };
  }

  const iso = yyyymmddToIso(yyyymmdd);
  const reason = HOLIDAY_REASON_BY_DATE.get(iso);
  if (reason) {
    return {
      date: yyyymmdd,
      openDay: false,
      openMinute: null,
      closeMinute: null,
      reason,
      sourceVersion: BUNDLED_KRX_CALENDAR_SOURCE_VERSION,
    };
  }

  return {
    date: yyyymmdd,
    openDay: true,
    openMinute: KRX_REGULAR_OPEN_MINUTE,
    closeMinute: KRX_REGULAR_CLOSE_MINUTE,
    reason: 'REGULAR',
    sourceVersion: BUNDLED_KRX_CALENDAR_SOURCE_VERSION,
  };
}

export function listBundledKrxCalendarDays(
  years: readonly number[] = BUNDLED_KRX_CALENDAR_YEARS,
): BundledKrxCalendarDay[] {
  const days: BundledKrxCalendarDay[] = [];
  for (const year of years) {
    if (!BUNDLED_KRX_CALENDAR_YEARS.includes(year as (typeof BUNDLED_KRX_CALENDAR_YEARS)[number])) {
      continue;
    }
    const cursor = new Date(year, 0, 1);
    while (cursor.getFullYear() === year) {
      const resolved = resolveBundledKrxTradingDay(cursor);
      if (resolved) days.push(resolved);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return days;
}
