export const LOG_TABLE_COLUMN_WIDTHS = {
  timestamp: 184,
  level: 86,
  category: 112,
  content: 820,
} as const;

export const LOG_TABLE_ROW_ESTIMATE = 42;

export const LOG_TABLE_TOTAL_WIDTH = Object.values(LOG_TABLE_COLUMN_WIDTHS).reduce(
  (sum, width) => sum + width,
  0,
);

export const LOG_DETAIL_PANEL_HEIGHT = '19.6rem';

const LOG_TS_CACHE_LIMIT = 600;
const logTsCache = new Map<number, string>();

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLogTs(ts: Date | number | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  const time = date.getTime();
  if (Number.isNaN(time)) return '-';

  const cached = logTsCache.get(time);
  if (cached) return cached;

  const next = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
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
