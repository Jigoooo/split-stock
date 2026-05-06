import { trpc } from '@renderer/shared/api/trpc';
import { formatDateOnly, thousandSeparator } from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import { BROKERS, type CryptoLot, type LotStatus, normalizeLotStatus } from '@shared/contracts';
import { type ReactElement, useState, useTransition } from 'react';
import {
  type AllTradeHistorySummary,
  buildTradeHistoryDayOptions,
  buildTradeHistoryYearOptions,
  createInitialTradeHistoryFilters,
  type DraftDay,
  type DraftFilters,
  getDaysInMonth,
} from '../lib/all-trade-history';
import { formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { AllTradeHistoryFilterBar } from './all-trade-history-filter-bar';
import { AllTradeHistorySummaryBar } from './all-trade-history-summary';

/**
 * 코인 '모든 매매내역' 패널 — stock AllTradeHistoryPanel 와 동등 구조.
 *
 * filter bar (검색/연/월/일) + summary chip + 통합 그리드.
 * trpc.crypto.listAllTradeHistoryLots 호출 (broker='UPBIT', market 무관).
 *
 * v1 보유 마켓별 섹션 표시 → v2 단일 통합 그리드 + 필터 (stock parity).
 */
export interface CryptoAllTradeHistoryPanelProps {
  accountId: number;
}

interface CryptoTradeHistoryRow {
  id: string;
  market: string;
  nth: number;
  buyPrice: number;
  qty: number;
  sellPrice: number | undefined;
  pnl: number | undefined;
  pnlRate: number | undefined;
  status: LotStatus;
  boughtAt: number;
  soldAt: number | undefined;
  amountKrw: number;
}

const COLS = {
  market: '14.4rem',
  nth: '5.2rem',
  buyPrice: '9.6rem',
  qty: '8.4rem',
  sellPrice: '9.6rem',
  pnl: '10.4rem',
  pnlRate: '8.8rem',
  status: '8.8rem',
  boughtAt: '11.6rem',
  soldAt: '11.6rem',
} as const;

const num = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

function toRow(lot: CryptoLot): CryptoTradeHistoryRow {
  const qty = num(lot.quantity);
  const buyPrice = num(lot.avgEntryKrw);
  const amountKrw = num(lot.allocatedKrw);
  const realizedPnl = num(lot.realizedPnl);
  const sellPrice = lot.status === 'closed' && qty > 0 ? buyPrice + realizedPnl / qty : undefined;
  const status = normalizeLotStatus(BROKERS.UPBIT, lot.status);
  const closedAt = lot.closedAt ?? undefined;
  return {
    id: `lot-${lot.id}`,
    market: lot.market,
    nth: lot.sequence,
    buyPrice,
    qty,
    sellPrice,
    pnl: lot.status === 'closed' ? realizedPnl : undefined,
    pnlRate: lot.status === 'closed' && amountKrw > 0 ? (realizedPnl / amountKrw) * 100 : undefined,
    status,
    boughtAt: lot.openedAt,
    soldAt: closedAt,
    amountKrw,
  };
}

export const CryptoAllTradeHistoryPanel = ({
  accountId,
}: CryptoAllTradeHistoryPanelProps): ReactElement => {
  const [draft, setDraft] = useState<DraftFilters>(() => createInitialTradeHistoryFilters());
  const [applied, setApplied] = useState<DraftFilters>(() => createInitialTradeHistoryFilters());
  const [isApplying, startTransition] = useTransition();

  const query = trpc.crypto.listAllTradeHistoryLots.useQuery({
    accountId,
    year: applied.year,
    month: applied.month,
    ...(applied.day !== 'all' ? { day: applied.day } : {}),
    ...(applied.search.trim() !== '' ? { search: applied.search.trim() } : {}),
  });

  const lots = query.data?.lots ?? [];
  const rows = lots.map(toRow);
  // 코인은 라이브 ticker 미연결 → open 차수 평가금액은 매입금액으로 대체 (stock priceByPdno 미가용 시 동일 fallback).
  // closed 차수는 매도금액 = 매입금액 + realizedPnl.
  const summary: AllTradeHistorySummary = rows.reduce(
    (acc, row) => {
      acc.count += 1;
      acc.buyAmount += row.amountKrw;
      if (row.status === 'SOLD' && row.pnl !== undefined) {
        acc.evaluationAmount += row.amountKrw + row.pnl;
        acc.pnlAmount += row.pnl;
      } else {
        acc.evaluationAmount += row.amountKrw;
      }
      return acc;
    },
    {
      count: 0,
      buyAmount: 0,
      evaluationAmount: 0,
      pnlAmount: 0,
      pnlRate: 0,
    },
  );
  summary.pnlRate = summary.buyAmount > 0 ? (summary.pnlAmount / summary.buyAmount) * 100 : 0;

  const yearOptions = buildTradeHistoryYearOptions(draft.year);
  const dayOptions = buildTradeHistoryDayOptions(draft.year, draft.month);

  const setSearch = (value: string): void => setDraft((prev) => ({ ...prev, search: value }));
  const setYear = (value: number): void =>
    setDraft((prev) => {
      const maxDay = getDaysInMonth(value, prev.month);
      return { ...prev, year: value, day: prev.day === 'all' ? 'all' : Math.min(prev.day, maxDay) };
    });
  const setMonth = (value: number): void =>
    setDraft((prev) => {
      const maxDay = getDaysInMonth(prev.year, value);
      return {
        ...prev,
        month: value,
        day: prev.day === 'all' ? 'all' : Math.min(prev.day, maxDay),
      };
    });
  const setDay = (value: DraftDay): void => setDraft((prev) => ({ ...prev, day: value }));
  const applyFilters = (): void => {
    startTransition(() => setApplied({ ...draft, search: draft.search.trim() }));
  };

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
      aria-label="코인 모든 매매내역 패널"
    >
      <AllTradeHistoryFilterBar
        applyFilters={applyFilters}
        dayOptions={dayOptions}
        draft={draft}
        isApplying={isApplying}
        setDay={setDay}
        setMonth={setMonth}
        setSearch={setSearch}
        setYear={setYear}
        yearOptions={yearOptions}
      />
      {query.error ? (
        <div style={{ padding: '0.6rem 0.8rem 0' }}>
          <span className="chip chip--down">{query.error.message}</span>
        </div>
      ) : null}
      <AllTradeHistorySummaryBar summary={summary} />
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="코인 모든 매매 내역"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={COLS.market}>마켓</TableGrid.Cell>
          <TableGrid.Cell width={COLS.nth} numeric>
            차수
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.buyPrice} numeric>
            매수가
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.sellPrice} numeric>
            매도가
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.pnl} numeric>
            손익
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.pnlRate} numeric>
            수익률
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.status}>상태</TableGrid.Cell>
          <TableGrid.Cell width={COLS.boughtAt} className="muted date-time-cell">
            매수일
          </TableGrid.Cell>
          <TableGrid.Cell width={COLS.soldAt} className="muted date-time-cell">
            매도일
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {query.isPending ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
            </TableGrid.Row>
          ) : rows.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">조회 결과 없음</TableGrid.Cell>
            </TableGrid.Row>
          ) : (
            rows.map((row) => {
              const cls =
                row.pnl === undefined
                  ? 'num-flat'
                  : row.pnl > 0
                    ? 'num-up'
                    : row.pnl < 0
                      ? 'num-down'
                      : 'num-flat';
              return (
                <TableGrid.Row key={row.id}>
                  <TableGrid.Cell width={COLS.market}>{row.market}</TableGrid.Cell>
                  <TableGrid.Cell width={COLS.nth} numeric>
                    {row.nth}차
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.buyPrice} numeric>
                    {formatCryptoPrice(row.buyPrice, row.market)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.qty} numeric>
                    {formatCryptoVolume(row.qty)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.sellPrice} numeric>
                    {row.sellPrice !== undefined
                      ? formatCryptoPrice(row.sellPrice, row.market)
                      : '-'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.pnl} numeric className={cls}>
                    {row.pnl !== undefined
                      ? `${row.pnl >= 0 ? '+' : ''}${thousandSeparator(Math.round(row.pnl))}`
                      : '-'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.pnlRate} numeric className={cls}>
                    {row.pnlRate !== undefined ? `${row.pnlRate.toFixed(2)}%` : '-'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.status}>{row.status}</TableGrid.Cell>
                  <TableGrid.Cell width={COLS.boughtAt} className="muted date-time-cell">
                    {formatDateOnly(row.boughtAt)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={COLS.soldAt} className="muted date-time-cell">
                    {row.soldAt !== undefined ? formatDateOnly(row.soldAt) : '-'}
                  </TableGrid.Cell>
                </TableGrid.Row>
              );
            })
          )}
        </TableGrid.Body>
      </TableGrid.Root>
    </section>
  );
};
