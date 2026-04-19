import { useAccountBalance, usePositionOverlay } from '@renderer/entities/account';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useDashboardRealtime } from '../model/use-dashboard-realtime';
import { AccountSummaryPanel } from './account-summary-panel';
import { PositionsPanel } from './positions-panel';

export const DashboardPage = (): ReactElement => {
  const balance = useAccountBalance();
  const realtime = useDashboardRealtime();
  const [selected, setSelected] = useState<{ pdno: string; name: string } | null>(null);
  const overlay = usePositionOverlay(selected?.pdno ?? null);

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

  if (!balance.data) {
    return (
      <div className="panel" style={{ margin: '1.2rem' }}>
        <div className="panel__title">에러</div>
        <div className="panel__body">
          <div className="chip chip--down">잔고 데이터를 불러오지 못했습니다.</div>
        </div>
      </div>
    );
  }

  const { positions, deposit, totalEval } = balance.data;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.2rem',
        height: '100%',
        minHeight: 0,
      }}
    >
      <AccountSummaryPanel
        deposit={deposit}
        positionsCount={positions.length}
        totalEval={totalEval}
      />

      <PositionsPanel
        positions={positions}
        selectedPdno={selected?.pdno ?? null}
        onSelect={setSelected}
      />

      {selected ? (
        <>
          <PositionChart pdno={selected.pdno} name={selected.name} lines={overlay.lines} />
          {realtime.isStarted ? (
            <TradingPanel pdno={selected.pdno} name={selected.name} isProd={realtime.isProd} />
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
                  disabled={realtime.startPending}
                  onClick={realtime.start}
                >
                  실시간 시작
                </button>
                {realtime.startError ? (
                  <span className="chip chip--down">{realtime.startError}</span>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
