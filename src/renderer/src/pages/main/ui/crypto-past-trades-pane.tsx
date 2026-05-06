import { useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import {
  formatDateOnly,
  formatDateTimeLongKo,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { Button, TableGrid } from '@renderer/shared/ui';
import type { CryptoLot } from '@shared/contracts';
import { type ReactElement, useState } from 'react';
import { formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';

/**
 * 코인 좌측 L2='과거 거래 종목' 탭 — stock PastTradesPane 와 동등.
 *
 * 현재 미보유 종목(=보유 잔고 0) 의 종료(closed) 차수만 마켓 단위로 집계.
 * 행 클릭 → 상세 사이클 표시.
 *
 * 데이터: trpc.crypto.listAllClosedLots(accountId) — broker='UPBIT' 통합 lots 테이블.
 */

export interface CryptoPastTradesPaneProps {
  accountId: number;
}

interface MarketGroup {
  market: string;
  lastTradedAt: number;
  totalBuyKrw: number;
  totalSellKrw: number;
  pnlRate: number;
  cycles: CryptoLot[];
}

const PAST_COLS = {
  market: '14.4rem',
  date: '11.6rem',
  buyAmount: '12.6rem',
  sellAmount: '12.6rem',
  pnlRate: '8.4rem',
} as const;

const DETAIL_COLS = {
  nth: '5.6rem',
  boughtAt: '11.6rem',
  soldAt: '11.6rem',
  buyPrice: '9.6rem',
  qty: '8.4rem',
  sellPrice: '9.6rem',
  pnl: '10.4rem',
  pnlRate: '8.4rem',
} as const;

const num = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const CryptoPastTradesPane = ({ accountId }: CryptoPastTradesPaneProps): ReactElement => {
  const balance = useBalanceWithLots('UPBIT');
  const closedQuery = trpc.crypto.listAllClosedLots.useQuery(
    { accountId, limit: 500 },
    { enabled: accountId > 0, staleTime: 5_000 },
  );
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);

  if (closedQuery.isPending || balance.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          {LOADING_MESSAGES.FETCHING}
        </div>
      </div>
    );
  }

  if (closedQuery.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{closedQuery.error.message}</span>
        </div>
      </div>
    );
  }

  const holdingMarkets = new Set(balance.positions.map((position) => position.code));
  const closedLots = closedQuery.data?.lots ?? [];
  const groupMap = new Map<string, MarketGroup>();
  for (const lot of closedLots) {
    if (holdingMarkets.has(lot.market)) continue;
    const buyKrw = num(lot.allocatedKrw);
    const sellKrw = buyKrw + num(lot.realizedPnl);
    const closedAt = lot.closedAt ?? 0;
    const existing = groupMap.get(lot.market);
    if (existing) {
      existing.totalBuyKrw += buyKrw;
      existing.totalSellKrw += sellKrw;
      existing.cycles.push(lot);
      if (closedAt > existing.lastTradedAt) existing.lastTradedAt = closedAt;
    } else {
      groupMap.set(lot.market, {
        market: lot.market,
        lastTradedAt: closedAt,
        totalBuyKrw: buyKrw,
        totalSellKrw: sellKrw,
        pnlRate: 0,
        cycles: [lot],
      });
    }
  }

  const groups: MarketGroup[] = [];
  for (const g of groupMap.values()) {
    g.pnlRate = g.totalBuyKrw > 0 ? ((g.totalSellKrw - g.totalBuyKrw) / g.totalBuyKrw) * 100 : 0;
    groups.push(g);
  }
  groups.sort((a, b) => b.lastTradedAt - a.lastTradedAt);
  const selectedGroup =
    selectedMarket !== null
      ? (groups.find((group) => group.market === selectedMarket) ?? null)
      : null;

  if (selectedGroup !== null) {
    return <CryptoPastTradeDetail group={selectedGroup} onBack={() => setSelectedMarket(null)} />;
  }

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div className="panel__title" style={{ flexShrink: 0 }}>
        과거 거래 종목 (현재 미보유 {thousandSeparator(groups.length)}종목)
      </div>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="코인 과거 거래 종목"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={PAST_COLS.market}>마켓</TableGrid.Cell>
          <TableGrid.Cell width={PAST_COLS.date}>마지막 거래일</TableGrid.Cell>
          <TableGrid.Cell width={PAST_COLS.buyAmount} numeric>
            총 매수금액
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_COLS.sellAmount} numeric>
            총 매도금액
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_COLS.pnlRate} numeric>
            수익률
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {groups.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">
                현재 미보유 과거 거래 종목이 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {groups.map((g) => {
            const cls = g.pnlRate > 0 ? 'num-up' : g.pnlRate < 0 ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={g.market} onClick={() => setSelectedMarket(g.market)}>
                <TableGrid.Cell width={PAST_COLS.market}>{g.market}</TableGrid.Cell>
                <TableGrid.Cell
                  width={PAST_COLS.date}
                  className="muted date-time-cell"
                  title={formatDateTimeLongKo(g.lastTradedAt)}
                >
                  {formatDateOnly(g.lastTradedAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_COLS.buyAmount} numeric>
                  {thousandSeparator(Math.round(g.totalBuyKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_COLS.sellAmount} numeric>
                  {thousandSeparator(Math.round(g.totalSellKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_COLS.pnlRate} numeric className={cls}>
                  {g.pnlRate.toFixed(2)}%
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};

interface DetailProps {
  group: MarketGroup;
  onBack: () => void;
}

const CryptoPastTradeDetail = ({ group, onBack }: DetailProps): ReactElement => {
  const sortedCycles = [...group.cycles].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const cls = group.pnlRate > 0 ? 'num-up' : group.pnlRate < 0 ? 'num-down' : 'num-flat';

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        className="panel__title"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap',
        }}
      >
        <span>{group.market}</span>
        <Button dense onClick={onBack}>
          목록으로
        </Button>
      </div>
      <section
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          padding: '0.5rem 0.8rem',
          borderBottom: '0.1rem solid var(--border)',
        }}
        aria-label={`${group.market} 과거 거래 요약`}
      >
        <span className="chip" title={formatDateTimeLongKo(group.lastTradedAt)}>
          마지막 거래일 {formatDateOnly(group.lastTradedAt)}
        </span>
        <span className="chip">총 매수 {thousandSeparator(Math.round(group.totalBuyKrw))}</span>
        <span className="chip">총 매도 {thousandSeparator(Math.round(group.totalSellKrw))}</span>
        <span className={`chip ${cls}`}>수익률 {group.pnlRate.toFixed(2)}%</span>
      </section>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label={`${group.market} 과거 매매 사이클`}
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={DETAIL_COLS.nth} numeric>
            차수
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.boughtAt} className="date-time-cell">
            매수일
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.soldAt} className="date-time-cell">
            매도일
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.buyPrice} numeric>
            매수가
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.sellPrice} numeric>
            매도가
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.pnl} numeric>
            손익
          </TableGrid.Cell>
          <TableGrid.Cell width={DETAIL_COLS.pnlRate} numeric>
            수익률
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {sortedCycles.map((lot) => {
            const buyPrice = num(lot.avgEntryKrw);
            const qty = num(lot.quantity);
            const allocated = num(lot.allocatedKrw);
            const pnl = num(lot.realizedPnl);
            const sellPrice = qty > 0 ? buyPrice + pnl / qty : 0;
            const pnlRate = allocated > 0 ? (pnl / allocated) * 100 : 0;
            const pnlCls = pnl > 0 ? 'num-up' : pnl < 0 ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={lot.id}>
                <TableGrid.Cell width={DETAIL_COLS.nth} numeric>
                  {lot.sequence}차
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={DETAIL_COLS.boughtAt}
                  className="muted date-time-cell"
                  title={formatDateTimeLongKo(lot.openedAt)}
                >
                  {formatDateOnly(lot.openedAt)}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={DETAIL_COLS.soldAt}
                  className="muted date-time-cell"
                  {...(lot.closedAt !== null ? { title: formatDateTimeLongKo(lot.closedAt) } : {})}
                >
                  {lot.closedAt !== null ? formatDateOnly(lot.closedAt) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={DETAIL_COLS.buyPrice} numeric>
                  {formatCryptoPrice(buyPrice, lot.market)}
                </TableGrid.Cell>
                <TableGrid.Cell width={DETAIL_COLS.qty} numeric>
                  {formatCryptoVolume(qty)}
                </TableGrid.Cell>
                <TableGrid.Cell width={DETAIL_COLS.sellPrice} numeric>
                  {sellPrice > 0 ? formatCryptoPrice(sellPrice, lot.market) : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width={DETAIL_COLS.pnl} numeric className={pnlCls}>
                  {pnl >= 0 ? '+' : ''}
                  {thousandSeparator(Math.round(pnl))}
                </TableGrid.Cell>
                <TableGrid.Cell width={DETAIL_COLS.pnlRate} numeric className={pnlCls}>
                  {pnlRate.toFixed(2)}%
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};
