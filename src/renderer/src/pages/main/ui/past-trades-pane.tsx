import { useBalanceWithLots } from '@renderer/entities/account';
import { type TradeCycle, useTradeCycles } from '@renderer/entities/trade-cycle';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { LOADING_MESSAGES } from '@renderer/shared/lib/loading-messages';
import { Button, TableGrid } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

export interface PastTradesPaneProps {
  accountId: number;
}

interface PdnoGroup {
  pdno: string;
  name: string;
  lastTradedAt: number; // ms epoch (soldAt max)
  totalBuyKrw: number;
  totalSellKrw: number;
  pnlRate: number; // (totalSell - totalBuy) / totalBuy * 100
  cycles: TradeCycle[];
}

const PAST_TRADES_COLS = {
  name: 168,
  date: 124,
  buyAmount: 126,
  sellAmount: 126,
  pnlRate: 84,
} as const;

const PAST_DETAIL_COLS = {
  nth: 56,
  boughtAt: 116,
  soldAt: 116,
  buyPrice: 96,
  qty: 84,
  sellPrice: 96,
  pnl: 104,
  pnlRate: 84,
} as const;

/**
 * L2="과거 거래 종목" 탭 컨텐트.
 *
 * closed(SOLD) 사이클 중 현재 미보유 종목만 종목 단위로 집계해서 표시한다.
 * 행 클릭은 전역 선택 상태를 바꾸지 않고 이 패널 안에서 상세로 전환한다.
 */
export const PastTradesPane = ({ accountId }: PastTradesPaneProps): ReactElement => {
  const balance = useBalanceWithLots();
  const { cycles, isPending, error } = useTradeCycles({ accountId, status: 'closed' });
  const [selectedPdno, setSelectedPdno] = useState<string | null>(null);

  if (isPending || balance.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          {LOADING_MESSAGES.FETCHING}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{error.message}</span>
        </div>
      </div>
    );
  }

  // 종목별 집계 — inline, no useMemo
  const holdingPdnos = new Set(balance.positions.map((position) => position.code));
  const groupMap = new Map<string, PdnoGroup>();
  for (const c of cycles) {
    if (holdingPdnos.has(c.pdno)) continue;
    const existing = groupMap.get(c.pdno);
    const sellKrw = (c.sellPrice ?? c.buyPrice) * c.qty;
    if (existing) {
      existing.totalBuyKrw += c.amountKrw;
      existing.totalSellKrw += sellKrw;
      existing.cycles.push(c);
      if ((c.soldAt ?? 0) > existing.lastTradedAt) {
        existing.lastTradedAt = c.soldAt ?? 0;
      }
    } else {
      groupMap.set(c.pdno, {
        pdno: c.pdno,
        name: c.name,
        lastTradedAt: c.soldAt ?? 0,
        totalBuyKrw: c.amountKrw,
        totalSellKrw: sellKrw,
        pnlRate: 0,
        cycles: [c],
      });
    }
  }

  const groups: PdnoGroup[] = [];
  for (const g of groupMap.values()) {
    g.pnlRate = g.totalBuyKrw > 0 ? ((g.totalSellKrw - g.totalBuyKrw) / g.totalBuyKrw) * 100 : 0;
    groups.push(g);
  }
  // 최근 거래 순
  groups.sort((a, b) => b.lastTradedAt - a.lastTradedAt);
  const selectedGroup =
    selectedPdno !== null ? (groups.find((group) => group.pdno === selectedPdno) ?? null) : null;

  if (selectedGroup !== null) {
    return <PastTradeDetail group={selectedGroup} onBack={() => setSelectedPdno(null)} />;
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
        aria-label="과거 거래 종목"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={PAST_TRADES_COLS.name}>종목명</TableGrid.Cell>
          <TableGrid.Cell width={PAST_TRADES_COLS.date}>마지막 거래일</TableGrid.Cell>
          <TableGrid.Cell width={PAST_TRADES_COLS.buyAmount} numeric>
            총 매수금액
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_TRADES_COLS.sellAmount} numeric>
            총 매도금액
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_TRADES_COLS.pnlRate} numeric>
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
            const rateClass = g.pnlRate > 0 ? 'num-up' : g.pnlRate < 0 ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={g.pdno} onClick={() => setSelectedPdno(g.pdno)}>
                <TableGrid.Cell width={PAST_TRADES_COLS.name}>
                  {g.name}{' '}
                  <span className="muted" style={{ fontSize: '0.9em' }}>
                    {g.pdno}
                  </span>
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_TRADES_COLS.date} numeric className="muted">
                  {formatDate(g.lastTradedAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_TRADES_COLS.buyAmount} numeric>
                  {thousandSeparator(Math.round(g.totalBuyKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_TRADES_COLS.sellAmount} numeric>
                  {thousandSeparator(Math.round(g.totalSellKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_TRADES_COLS.pnlRate} numeric className={rateClass}>
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

interface PastTradeDetailProps {
  group: PdnoGroup;
  onBack: () => void;
}

const PastTradeDetail = ({ group, onBack }: PastTradeDetailProps): ReactElement => {
  const sortedCycles = [...group.cycles].sort((a, b) => (b.soldAt ?? 0) - (a.soldAt ?? 0));
  const rateClass = group.pnlRate > 0 ? 'num-up' : group.pnlRate < 0 ? 'num-down' : 'num-flat';

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
        <span>
          {group.name}{' '}
          <span className="muted" style={{ fontSize: '0.9em' }}>
            {group.pdno}
          </span>
        </span>
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
        aria-label={`${group.name} 과거 거래 요약`}
      >
        <span className="chip">마지막 거래일 {formatDate(group.lastTradedAt)}</span>
        <span className="chip">총 매수 {formatKrw(group.totalBuyKrw)}</span>
        <span className="chip">총 매도 {formatKrw(group.totalSellKrw)}</span>
        <span className={`chip ${rateClass}`}>수익률 {group.pnlRate.toFixed(2)}%</span>
      </section>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label={`${group.name} 과거 매매 사이클`}
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={PAST_DETAIL_COLS.nth} numeric>
            차수
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.boughtAt}>매수일</TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.soldAt}>매도일</TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.buyPrice} numeric>
            매수가
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.qty} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.sellPrice} numeric>
            매도가
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.pnl} numeric>
            손익
          </TableGrid.Cell>
          <TableGrid.Cell width={PAST_DETAIL_COLS.pnlRate} numeric>
            수익률
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {sortedCycles.map((cycle) => {
            const pnl = getCyclePnl(cycle);
            const pnlRate = getCyclePnlRate(cycle, pnl);
            const pnlClass = pnl > 0 ? 'num-up' : pnl < 0 ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={cycle.id}>
                <TableGrid.Cell width={PAST_DETAIL_COLS.nth} numeric>
                  {cycle.nth}차
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.boughtAt} className="muted">
                  {formatDate(cycle.boughtAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.soldAt} className="muted">
                  {formatDate(cycle.soldAt ?? 0)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.buyPrice} numeric>
                  {formatKrw(cycle.buyPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.qty} numeric>
                  {thousandSeparator(cycle.qty)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.sellPrice} numeric>
                  {formatKrw(cycle.sellPrice ?? cycle.buyPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.pnl} numeric className={pnlClass}>
                  {formatSignedKrw(pnl)}
                </TableGrid.Cell>
                <TableGrid.Cell width={PAST_DETAIL_COLS.pnlRate} numeric className={pnlClass}>
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

function formatDate(epochMs: number): string {
  if (epochMs === 0) return '-';
  const d = new Date(epochMs);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatKrw(value: number): string {
  return thousandSeparator(Math.round(value));
}

function formatSignedKrw(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatKrw(Math.abs(value))}`;
}

function getCyclePnl(cycle: TradeCycle): number {
  if (cycle.pnl !== undefined) return cycle.pnl;
  return (cycle.sellPrice ?? cycle.buyPrice) * cycle.qty - cycle.amountKrw;
}

function getCyclePnlRate(cycle: TradeCycle, pnl: number): number {
  if (cycle.pnlRate !== undefined) return cycle.pnlRate;
  return cycle.amountKrw > 0 ? (pnl / cycle.amountKrw) * 100 : 0;
}
