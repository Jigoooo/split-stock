import { useTradeCycles } from '@renderer/entities/trade-cycle';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <table
          className="hts-table"
          aria-label="과거 거래 종목"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col />
            <col />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th>종목명</th>
              <th>마지막 거래일</th>
              <th className="num">총 매수금액</th>
              <th className="num">총 매도금액</th>
              <th className="num">수익률</th>
            </tr>
          </thead>
        </table>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table
            className="hts-table"
            aria-label="과거 거래 종목 바디"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col />
              <col />
              <col style={{ width: '14%' }} />
            </colgroup>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                    과거 거래 없음
                  </td>
                </tr>
              ) : null}
              {groups.map((g) => {
                const rateClass =
                  g.pnlRate > 0 ? 'num-up' : g.pnlRate < 0 ? 'num-down' : 'num-flat';
                return (
                  <tr
                    key={g.pdno}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(g.pdno)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(g.pdno);
                    }}
                  >
                    <td>
                      {g.name}{' '}
                      <span className="muted" style={{ fontSize: '0.9em' }}>
                        {g.pdno}
                      </span>
                    </td>
                    <td className="muted num">{formatDate(g.lastTradedAt)}</td>
                    <td className="num">{thousandSeparator(Math.round(g.totalBuyKrw))}</td>
                    <td className="num">{thousandSeparator(Math.round(g.totalSellKrw))}</td>
                    <td className={`num ${rateClass}`}>{g.pnlRate.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

function formatDate(epochMs: number): string {
  if (epochMs === 0) return '-';
  const d = new Date(epochMs);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
