import { Button, Select, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { DraftDay, DraftFilters } from '../lib/all-trade-history';

interface AllTradeHistoryFilterBarProps {
  applyFilters: () => void;
  dayOptions: number[];
  draft: DraftFilters;
  isApplying: boolean;
  setDay: (value: DraftDay) => void;
  setMonth: (value: number) => void;
  setSearch: (value: string) => void;
  setYear: (value: number) => void;
  yearOptions: number[];
}

export const AllTradeHistoryFilterBar = ({
  applyFilters,
  dayOptions,
  draft,
  isApplying,
  setDay,
  setMonth,
  setSearch,
  setYear,
  yearOptions,
}: AllTradeHistoryFilterBarProps): ReactElement => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: '0.6rem',
      padding: '0.8rem',
      borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      flexWrap: 'wrap',
      flexShrink: 0,
    }}
  >
    <label htmlFor="all-trade-history-search" style={filterFieldStyle}>
      <span className="muted">검색어</span>
      <TextInput
        id="all-trade-history-search"
        value={draft.search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="종목명/종목코드 검색"
        aria-label="모든 매매 내역 검색어"
        dense
      />
    </label>
    <label htmlFor="all-trade-history-year" style={smallFilterFieldStyle}>
      <span className="muted">연</span>
      <Select
        id="all-trade-history-year"
        value={String(draft.year)}
        onChange={(event) => setYear(Number(event.target.value))}
        aria-label="모든 매매 내역 연도"
        dense
      >
        {yearOptions.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    </label>
    <label htmlFor="all-trade-history-month" style={smallFilterFieldStyle}>
      <span className="muted">월</span>
      <Select
        id="all-trade-history-month"
        value={String(draft.month)}
        onChange={(event) => setMonth(Number(event.target.value))}
        aria-label="모든 매매 내역 월"
        dense
      >
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </Select>
    </label>
    <label htmlFor="all-trade-history-day" style={smallFilterFieldStyle}>
      <span className="muted">일</span>
      <Select
        id="all-trade-history-day"
        value={draft.day === 'all' ? 'all' : String(draft.day)}
        onChange={(event) =>
          setDay(event.target.value === 'all' ? 'all' : Number(event.target.value))
        }
        aria-label="모든 매매 내역 일자"
        dense
      >
        <option value="all">전체</option>
        {dayOptions.map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </Select>
    </label>
    <Button onClick={applyFilters} dense disabled={isApplying}>
      조회
    </Button>
  </div>
);

const filterFieldStyle = {
  display: 'grid',
  gap: '0.25rem',
  minWidth: '12rem',
} as const;

const smallFilterFieldStyle = {
  display: 'grid',
  gap: '0.25rem',
  minWidth: '5.5rem',
} as const;
