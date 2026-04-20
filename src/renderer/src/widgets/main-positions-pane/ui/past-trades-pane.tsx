import { useTradeCycles } from '@renderer/entities/trade-cycle';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

export interface PastTradesPaneProps {
  accountId: number;
  onSelect: (pdno: string) => void;
}

interface PdnoGroup {
  pdno: string;
  name: string;
  lastTradedAt: number; // ms epoch (soldAt max)
  totalBuyKrw: number;
  totalSellKrw: number;
  pnlRate: number; // (totalSell - totalBuy) / totalBuy * 100
}

/**
 * L2="과거 거래 종목" 탭 컨텐트.
 *
 * closed(SOLD) 사이클을 종목 단위로 집계해서 테이블로 표시.
 * 행 클릭 → onSelect(pdno).
 */
export const PastTradesPane = ({ accountId, onSelect }: PastTradesPaneProps): ReactElement => {
  const { cycles, isPending, error } = useTradeCycles({ accountId, status: 'closed' });

  if (isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          조회 중…
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
  const groupMap = new Map<string, PdnoGroup>();
  for (const c of cycles) {
    const existing = groupMap.get(c.pdno);
    const sellKrw = (c.sellPrice ?? 0) * c.qty;
    if (existing) {
      existing.totalBuyKrw += c.amountKrw;
      existing.totalSellKrw += sellKrw;
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
        과거 거래 종목 ({thousandSeparator(groups.length)}종목)
      </div>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        aria-label="과거 거래 종목"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell flex={1}>종목명</TableGrid.Cell>
          <TableGrid.Cell flex={1}>마지막 거래일</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            총 매수금액
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            총 매도금액
          </TableGrid.Cell>
          <TableGrid.Cell width={80} numeric>
            수익률
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {groups.length === 0 ? (
            <TableGrid.Row>
              <TableGrid.Cell flex={1} className="muted" style={{ textAlign: 'center' }}>
                과거 거래 없음
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {groups.map((g) => {
            const rateClass = g.pnlRate > 0 ? 'num-up' : g.pnlRate < 0 ? 'num-down' : 'num-flat';
            return (
              <TableGrid.Row key={g.pdno} onClick={() => onSelect(g.pdno)}>
                <TableGrid.Cell flex={1}>
                  {g.name}{' '}
                  <span className="muted" style={{ fontSize: '0.9em' }}>
                    {g.pdno}
                  </span>
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="muted">
                  {formatDate(g.lastTradedAt)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {thousandSeparator(Math.round(g.totalBuyKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {thousandSeparator(Math.round(g.totalSellKrw))}
                </TableGrid.Cell>
                <TableGrid.Cell width={80} numeric className={rateClass}>
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

function formatDate(epochMs: number): string {
  if (epochMs === 0) return '-';
  const d = new Date(epochMs);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
