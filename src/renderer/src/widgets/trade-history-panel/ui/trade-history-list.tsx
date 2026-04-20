import { type CycleStatusFilter, useTradeCycles } from '@renderer/entities/trade-cycle';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';

export interface TradeHistoryListProps {
  accountId: number;
  pdno: string | null;
  status: CycleStatusFilter;
}

/**
 * 매매 사이클 리스트 — 종목별/전체 진행중/종료/전체.
 *
 * 표시 컬럼: 차수 / 종목 / 매수가 / 수량 / 매도가 / 손익 / 수익률 / 상태 / 매수일 / 매도일
 *
 * useTradeCycles 가 pdno 미지정 시 계좌 전체 사이클을 반환.
 */
export const TradeHistoryList = (props: TradeHistoryListProps): ReactElement => {
  const { accountId, pdno, status } = props;
  const { cycles, error, isPending } = useTradeCycles(
    pdno !== null ? { accountId, pdno, status } : { accountId, status },
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table
          className="hts-table"
          style={{ width: '100%' }}
          aria-label={pdno ? `${pdno} 매매 사이클` : '전체 매매 사이클'}
        >
          <thead>
            <tr>
              <th className="num">차수</th>
              <th>종목</th>
              <th className="num">매수가</th>
              <th className="num">수량</th>
              <th className="num">매도가</th>
              <th className="num">손익</th>
              <th className="num">수익률</th>
              <th>상태</th>
              <th className="muted">매수일</th>
              <th className="muted">매도일</th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: 'center' }}>
                  로드 중…
                </td>
              </tr>
            ) : cycles.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted" style={{ textAlign: 'center' }}>
                  사이클 없음
                </td>
              </tr>
            ) : (
              cycles.map((cycle) => {
                const pnl = cycle.pnl;
                const sign =
                  pnl === undefined ? 'flat' : pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat';
                const cls = sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';
                return (
                  <tr key={cycle.id}>
                    <td className="num">{cycle.nth}차</td>
                    <td>
                      <span className="num">{cycle.pdno}</span>
                      <span className="muted" style={{ marginLeft: '0.4rem' }}>
                        {cycle.name}
                      </span>
                    </td>
                    <td className="num">{thousandSeparator(cycle.buyPrice)}</td>
                    <td className="num">{thousandSeparator(cycle.qty)}</td>
                    <td className="num">
                      {cycle.sellPrice !== undefined ? thousandSeparator(cycle.sellPrice) : '-'}
                    </td>
                    <td className={`num ${cls}`}>
                      {pnl !== undefined ? formatSigned(Math.round(pnl)) : '-'}
                    </td>
                    <td className={`num ${cls}`}>
                      {cycle.pnlRate !== undefined ? `${cycle.pnlRate.toFixed(2)}%` : '-'}
                    </td>
                    <td>{cycle.status}</td>
                    <td className="muted">
                      {new Date(cycle.boughtAt).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="muted">
                      {cycle.soldAt !== undefined
                        ? new Date(cycle.soldAt).toLocaleDateString('ko-KR')
                        : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(value)}`;
}
