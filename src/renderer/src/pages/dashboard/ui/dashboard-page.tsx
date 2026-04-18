import { trpc } from '@renderer/shared/api/trpc';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useState } from 'react';

export const DashboardPage = (): ReactElement => {
  const balance = trpc.account.getBalance.useQuery();
  const envQuery = trpc.auth.getEnv.useQuery();
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: (envQuery.data?.env ?? null) !== null,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation();
  const [selected, setSelected] = useState<{ pdno: string; name: string } | null>(null);
  const overlay = trpc.account.getPositionOverlay.useQuery(
    { pdno: selected?.pdno ?? '000000' },
    { enabled: selected !== null },
  );

  if (balance.isPending) {
    return (
      <div className="muted" style={{ padding: '1.2rem' }}>
        잔고 조회 중…
      </div>
    );
  }

  if (balance.error) {
    return (
      <div className="panel" style={{ margin: '1.2rem' }}>
        <div className="panel__title">에러</div>
        <div className="panel__body">
          <div className="chip chip--down">{balance.error.message}</div>
        </div>
      </div>
    );
  }

  const { positions, deposit, totalEval } = balance.data;

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">계좌 요약</div>
        <div className="panel__body" style={{ display: 'flex', gap: '2.4rem', flexWrap: 'wrap' }}>
          <Kpi label="예수금 총액" value={deposit} />
          <Kpi label="총 평가금액" value={totalEval} />
          <Kpi label="보유 종목 수" value={positions.length} unit="종목" />
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">보유 종목</div>
        <div className="panel__body" style={{ padding: 0 }}>
          <table className="hts-table">
            <thead>
              <tr>
                <th>종목코드</th>
                <th>종목명</th>
                <th className="num">보유수량</th>
                <th className="num">평균단가</th>
                <th className="num">현재가</th>
                <th className="num">평가금액</th>
                <th className="num">손익</th>
                <th className="num">수익률</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center' }}>
                    보유 종목이 없습니다.
                  </td>
                </tr>
              )}
              {positions.map((p) => {
                const sign = p.pnlAmount === 0 ? 'flat' : p.pnlAmount > 0 ? 'up' : 'down';
                const colorClass =
                  sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';
                const isSelected = selected?.pdno === p.code;
                return (
                  <tr
                    key={p.code}
                    onClick={() => setSelected({ pdno: p.code, name: p.name })}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(45, 79, 202, 0.08)' : undefined,
                    }}
                  >
                    <td className="num">{p.code}</td>
                    <td>{p.name}</td>
                    <td className="num">{formatKrw(p.qty)}</td>
                    <td className="num">{formatKrw(p.avgPrice)}</td>
                    <td className="num">{formatKrw(p.currentPrice)}</td>
                    <td className="num">{formatKrw(p.evalAmount)}</td>
                    <td className={`num ${colorClass}`}>{formatKrw(p.pnlAmount, true)}</td>
                    <td className={`num ${colorClass}`}>{p.pnlRate.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <>
          <PositionChart
            pdno={selected.pdno}
            name={selected.name}
            lines={overlay.data?.lines ?? []}
          />
          {realtimeStatus.data?.started ? (
            <TradingPanel
              pdno={selected.pdno}
              name={selected.name}
              isProd={envQuery.data?.env === 'PROD'}
            />
          ) : (
            <div className="panel">
              <div
                className="panel__body"
                style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}
              >
                <span className="muted">실시간 피드 미활성</span>
                <button
                  type="button"
                  className="hts-btn hts-btn--primary"
                  disabled={startRealtime.isPending}
                  onClick={() => startRealtime.mutate()}
                >
                  실시간 시작
                </button>
                {startRealtime.error ? (
                  <span className="chip chip--down">{startRealtime.error.message}</span>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

const Kpi = ({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </div>
    <div className="num" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
      {formatKrw(value)}
      {unit ? (
        <span className="muted" style={{ fontSize: '1.1rem', marginLeft: '0.4rem' }}>
          {unit}
        </span>
      ) : null}
    </div>
  </div>
);

function formatKrw(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '-';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${Math.round(value).toLocaleString('ko-KR')}`;
}
