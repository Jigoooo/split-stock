export const LOG_TABLE_COLUMN_WIDTHS = {
  timestamp: 158,
  level: 82,
  category: 104,
  content: 720,
} as const;

export const LOG_TABLE_ROW_ESTIMATE = 42;

export const LOG_TABLE_TOTAL_WIDTH = Object.values(LOG_TABLE_COLUMN_WIDTHS).reduce(
  (sum, width) => sum + width,
  0,
);

export const LOG_DETAIL_PANEL_HEIGHT = '19.6rem';

const LOG_TS_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const LOG_TS_CACHE_LIMIT = 600;
const logTsCache = new Map<number, string>();

export function formatLogTs(ts: Date | number | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  const time = date.getTime();
  if (Number.isNaN(time)) return '-';

  const cached = logTsCache.get(time);
  if (cached) return cached;

  const next = LOG_TS_FORMATTER.format(date);
  logTsCache.set(time, next);
  if (logTsCache.size > LOG_TS_CACHE_LIMIT) {
    const oldestKey = logTsCache.keys().next().value;
    if (oldestKey !== undefined) {
      logTsCache.delete(oldestKey);
    }
  }
  return next;
}

export function levelClass(level: string): string {
  if (level === 'ERROR') return 'chip chip--down';
  if (level === 'WARN') return 'chip';
  return 'chip chip--up';
}
