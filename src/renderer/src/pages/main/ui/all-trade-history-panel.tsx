import { Button, Select, TableGrid, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useAllTradeHistory } from '../model/use-all-trade-history';

export interface AllTradeHistoryPanelProps {
  accountId: number;
}

const ALL_TRADE_HISTORY_COLS = {
  nth: 60,
  date: 110,
  name: 180,
  qty: 72,
  buyPrice: 92,
  side: 72,
  sellPrice: 92,
  pnl: 100,
  pnlRate: 82,
} as const;

export const AllTradeHistoryPanel = ({ accountId }: AllTradeHistoryPanelProps): ReactElement => {
  const {
    applyFilters,
    dayOptions,
    draft,
    error,
    isApplying,
    isPending,
    rows,
    setDay,
    setMonth,
    setSearch,
    setYear,
    summary,
    yearOptions,
  } = useAllTradeHistory(accountId);

  return (
    <section
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label="모든 매매 내역 패널"
    >
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

      {error ? (
        <div style={{ padding: '0.6rem 0.8rem 0' }}>
          <span className="chip chip--down">{error.message}</span>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: '0.6rem',
          padding: '0.8rem',
          borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
          flexShrink: 0,
        }}
      >
        <SummaryCard label="매매건수" value={`${summary.count}건`} />
        <SummaryCard label="매입금액" value={formatNumber(summary.buyAmount)} />
        <SummaryCard label="평가/매도금액" value={formatNumber(summary.evaluationAmount)} />
        <SummaryCard
          label="손익액"
          value={formatSigned(summary.pnlAmount)}
          className={numberClassName(summary.pnlAmount)}
        />
        <SummaryCard
          label="수익률"
          value={`${summary.pnlRate.toFixed(2)}%`}
          className={numberClassName(summary.pnlAmount)}
        />
      </div>

      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="모든 매매 내역 상세 목록"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.nth}>차수</TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.date}>날짜</TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.name}>종목명</TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.buyPrice} numeric>
            매입단가
          </TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.side}>매매구분</TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.sellPrice} numeric>
            매도단가
          </TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnl} numeric>
            평가손익
          </TableGrid.Cell>
          <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.pnlRate} numeric>
            수익률
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {isPending && rows.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">조회 중…</TableGrid.Cell>
            </TableGrid.Row>
          ) : rows.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">매매 내역 없음</TableGrid.Cell>
            </TableGrid.Row>
          ) : (
            rows.map((row) => (
              <TableGrid.Row key={row.key}>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.nth}>{row.nthText}</TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.date} className="muted">
                  {row.dateText}
                </TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.name}>
                  {row.nameText}
                  {row.pdnoText !== '' ? (
                    <span className="muted" style={{ marginLeft: '0.35rem' }}>
                      {row.pdnoText}
                    </span>
                  ) : null}
                </TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.qty} numeric>
                  {row.qtyText}
                </TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.buyPrice} numeric>
                  {row.buyPriceText}
                </TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.side}>{row.sideText}</TableGrid.Cell>
                <TableGrid.Cell width={ALL_TRADE_HISTORY_COLS.sellPrice} numeric>
                  {row.sellPriceText}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={ALL_TRADE_HISTORY_COLS.pnl}
                  numeric
                  className={row.pnlClassName}
                >
                  {row.pnlText}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={ALL_TRADE_HISTORY_COLS.pnlRate}
                  numeric
                  className={row.pnlClassName}
                >
                  {row.pnlRateText}
                </TableGrid.Cell>
              </TableGrid.Row>
            ))
          )}
        </TableGrid.Body>
      </TableGrid.Root>
    </section>
  );
};

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

const SummaryCard = ({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}): ReactElement => (
  <div
    style={{
      padding: '0.55rem 0.65rem',
      border: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      background: 'rgba(255,255,255,0.5)',
    }}
  >
    <div className="muted" style={{ fontSize: '1rem' }}>
      {label}
    </div>
    <div
      className={['num', className ?? ''].filter(Boolean).join(' ')}
      style={{ fontSize: '1.45rem', fontWeight: 600 }}
    >
      {value}
    </div>
  </div>
);

function formatNumber(value: number): string {
  return value === 0 ? '0' : formatSigned(value).replace(/^\+/, '');
}

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('ko-KR')}`;
}

function numberClassName(value: number): string {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}
