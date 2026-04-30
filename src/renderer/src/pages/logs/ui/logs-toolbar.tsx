import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Select, TextInput } from '@renderer/shared/ui';
import { Search, X } from 'lucide-react';
import type { ReactElement } from 'react';
import {
  LOG_LEVELS,
  LOG_STREAMS,
  LOG_TAIL_LIMIT,
  type LogDateRange,
  type LogExportFormat,
  type LogLevel,
  type LogStream,
} from '../model/use-log-tail';

interface LogsToolbarProps {
  dateRange: LogDateRange;
  entriesCount: number;
  exportDisabled: boolean;
  exportPending: boolean;
  level: LogLevel;
  onExport: (format: LogExportFormat) => void;
  search: string;
  stream: LogStream;
  setDateRange: (range: LogDateRange) => void;
  setLevel: (level: LogLevel) => void;
  setSearch: (search: string) => void;
  setStream: (stream: LogStream) => void;
}

export const LogsToolbar = ({
  dateRange,
  entriesCount,
  exportDisabled,
  exportPending,
  level,
  onExport,
  search,
  stream,
  setDateRange,
  setLevel,
  setSearch,
  setStream,
}: LogsToolbarProps): ReactElement => (
  <div
    className="panel__body logs-toolbar"
    style={{ alignItems: 'end', display: 'flex', flexShrink: 0, flexWrap: 'wrap', gap: '0.8rem' }}
  >
    <label htmlFor="logs-level" style={{ display: 'grid', flex: '0 0 9rem', gap: '0.25rem' }}>
      <span className="muted">레벨</span>
      <Select
        id="logs-level"
        value={level}
        onChange={(event) => setLevel(event.target.value as LogLevel)}
        dense
      >
        {LOG_LEVELS.map((item) => (
          <option key={item} value={item}>
            {item || '전체'}
          </option>
        ))}
      </Select>
    </label>
    <label htmlFor="logs-stream" style={{ display: 'grid', flex: '0 0 9rem', gap: '0.25rem' }}>
      <span className="muted">구분</span>
      <Select
        id="logs-stream"
        value={stream}
        onChange={(event) => setStream(event.target.value as LogStream)}
        dense
      >
        {LOG_STREAMS.map((item) => (
          <option key={item} value={item}>
            {item === 'normal' ? '일반' : item === 'error' ? '에러' : '전체'}
          </option>
        ))}
      </Select>
    </label>
    <label htmlFor="logs-date-range" style={{ display: 'grid', flex: '0 0 11rem', gap: '0.25rem' }}>
      <span className="muted">기간</span>
      <Select
        id="logs-date-range"
        value={dateRange}
        onChange={(event) => setDateRange(event.target.value as LogDateRange)}
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
    <label htmlFor="logs-search" style={{ display: 'grid', flex: '1 1 24rem', gap: '0.25rem' }}>
      <span className="muted">검색</span>
      <TextInput
        id="logs-search"
        type="text"
        placeholder="메시지 / payload 검색..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        dense
        iconLeading={<Search size={14} />}
        suffix={
          search ? (
            <button type="button" aria-label="검색어 지우기" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          ) : null
        }
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
      <Button dense onClick={() => onExport('csv')} disabled={exportPending || exportDisabled}>
        CSV 저장
      </Button>
      <Button dense onClick={() => onExport('json')} disabled={exportPending || exportDisabled}>
        JSON 저장
      </Button>
    </div>
  </div>
);
