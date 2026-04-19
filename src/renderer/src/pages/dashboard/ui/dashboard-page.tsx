import { useAccountBalance, usePositionOverlay } from '@renderer/entities/account';
import { Button } from '@renderer/shared/ui';
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
    return <StatusPanel title="잔고 조회 중" body="계좌와 보유 종목을 불러오고 있습니다." />;
  }

  if (balance.error) {
    return <StatusPanel title="잔고 조회 실패" body={balance.error.message} tone="down" />;
  }

  if (!balance.data) {
    return (
      <StatusPanel title="잔고 데이터 없음" body="잔고 데이터를 불러오지 못했습니다." tone="down" />
    );
  }

  const { positions, deposit, totalEval } = balance.data;

  return (
    <div className="dashboard-shell">
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
        <div className="dashboard-detail-grid">
          <PositionChart pdno={selected.pdno} name={selected.name} lines={overlay.lines} />
          {realtime.isStarted ? (
            <TradingPanel pdno={selected.pdno} name={selected.name} isProd={realtime.isProd} />
          ) : (
            <div className="panel dashboard-realtime-panel">
              <div className="panel__title">실시간 연동</div>
              <div className="panel__body dashboard-realtime-panel__body">
                <div className="muted">
                  <strong>{selected.name}</strong>를 선택했습니다. 실시간 피드를 시작하면 오른쪽
                  주문 패널이 활성화됩니다.
                </div>
                <Button
                  disabled={realtime.startPending}
                  onClick={realtime.start}
                  variant="primary"
                  dense
                >
                  실시간 시작
                </Button>
                {realtime.startError ? (
                  <span className="chip chip--down">{realtime.startError}</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="panel dashboard-detail-empty">
          <div className="panel__title">상세 영역</div>
          <div className="panel__body dashboard-detail-empty__body">
            <div className="muted">
              보유 종목을 선택하면 차트와 주문 패널이 이 영역에 표시됩니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function StatusPanel({
  title,
  body,
  tone = 'default',
}: {
  title: string;
  body: string;
  tone?: 'default' | 'down';
}): ReactElement {
  return (
    <div className="panel dashboard-status-panel">
      <div className="panel__title">{title}</div>
      <div className="panel__body">
        <span className={tone === 'down' ? 'chip chip--down' : 'chip'}>{body}</span>
      </div>
    </div>
  );
}
