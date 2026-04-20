import { useAccountBalance, usePositionOverlay } from '@renderer/entities/account';
import { Button, ErrorBoundary } from '@renderer/shared/ui';
import { HtsTabs } from '@renderer/widgets/hts-tabs';
import { PositionChart } from '@renderer/widgets/position-chart';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { startTransition, useState } from 'react';
import { useDashboardRealtime } from '../model/use-dashboard-realtime';
import { AccountSummaryPanel } from './account-summary-panel';
import { PositionsPanel } from './positions-panel';
import { StrategyTab } from './strategy-tab';

type DashboardTabId = 'overview' | 'strategy';

const TABS: ReadonlyArray<{ id: DashboardTabId; label: string }> = [
  { id: 'overview', label: '현황' },
  { id: 'strategy', label: '차수 설정' },
];

export const DashboardPage = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');

  const onChangeTab = (id: DashboardTabId): void => {
    // useTransition 으로 탭 전환을 부드럽게 — query/렌더 비용이 있어도 click 즉시 반응.
    startTransition(() => {
      setActiveTab(id);
    });
  };

  return (
    <div
      className="dashboard-shell"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}
    >
      <HtsTabs ariaLabel="대시보드 탭" tabs={TABS} active={activeTab} onChange={onChangeTab} />
      <div
        role="tabpanel"
        id={`hts-tabpanel-${activeTab}`}
        aria-labelledby={`hts-tab-${activeTab}`}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {activeTab === 'overview' ? (
          <ErrorBoundary name="현황">
            <OverviewTab />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="차수 설정">
            <StrategyTab />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
};

/**
 * 기존 DashboardPage 콘텐츠를 그대로 보존 — 잔고/포지션/차트/주문 패널.
 */
const OverviewTab = (): ReactElement => {
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
