import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Select } from '@renderer/shared/ui';
import type { ReactElement, TransitionStartFunction } from 'react';
import {
  LOG_LEVELS,
  LOG_TAIL_LIMIT,
  type LogDateRange,
  type LogExportFormat,
  type LogLevel,
} from '../model/use-log-tail';

interface LogsToolbarProps {
  dateRange: LogDateRange;
  entriesCount: number;
  exportPending: boolean;
  level: LogLevel;
  onExport: (format: LogExportFormat) => void;
  search: string;
  setDateRange: (range: LogDateRange) => void;
  setLevel: (level: LogLevel) => void;
  setSearch: (search: string) => void;
  startTransition: TransitionStartFunction;
}

export const LogsToolbar = ({
  dateRange,
  entriesCount,
  exportPending,
  level,
  onExport,
  search,
  setDateRange,
  setLevel,
  setSearch,
  startTransition,
}: LogsToolbarProps): ReactElement => (
  <div
    className="panel__body"
    style={{ display: 'flex', gap: '0.8rem', alignItems: 'end', flexWrap: 'wrap', flexShrink: 0 }}
  >
    <label htmlFor="logs-level" style={{ display: 'grid', gap: '0.25rem' }}>
      <span className="muted">레벨</span>
      <Select
        id="logs-level"
        value={level}
        onChange={(event) => startTransition(() => setLevel(event.target.value as LogLevel))}
        dense
      >
        {LOG_LEVELS.map((item) => (
          <option key={item} value={item}>
            {item || '전체'}
          </option>
        ))}
      </Select>
    </label>
    <label htmlFor="logs-date-range" style={{ display: 'grid', gap: '0.25rem' }}>
      <span className="muted">기간</span>
      <Select
        id="logs-date-range"
        value={dateRange}
        onChange={(event) =>
          startTransition(() => setDateRange(event.target.value as LogDateRange))
        }
        dense
      >
        <option value="">전체</option>
        <option value="today">오늘</option>
        <option value="month">이번달</option>
        <option value="lastMonth">지난달</option>
        <option value="last3Months">3개월</option>
        <option value="year">1년</option>
      </Select>
    </label>
    <label htmlFor="logs-search" style={{ display: 'grid', gap: '0.25rem' }}>
      <span className="muted">검색</span>
      <input
        id="logs-search"
        type="text"
        placeholder="메시지 / payload 검색..."
        value={search}
        onChange={(event) => startTransition(() => setSearch(event.target.value))}
        style={{ padding: '0.4rem', fontSize: '0.9rem' }}
      />
    </label>
    <div
      style={{
        display: 'flex',
        gap: '0.6rem',
        alignItems: 'center',
        marginLeft: 'auto',
        flexWrap: 'wrap',
      }}
    >
      <span className="muted">
        최근 최대 {thousandSeparator(LOG_TAIL_LIMIT)}건 중 {thousandSeparator(entriesCount)}건 표시
      </span>
      <Button dense onClick={() => onExport('csv')} disabled={exportPending}>
        CSV 저장
      </Button>
      <Button dense onClick={() => onExport('json')} disabled={exportPending}>
        JSON 저장
      </Button>
    </div>
  </div>
);
