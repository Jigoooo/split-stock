import { DashboardPage } from '@renderer/pages/dashboard';
import { LogsPage } from '@renderer/pages/logs';
import { ReportsPage } from '@renderer/pages/reports';
import { SettingsPage } from '@renderer/pages/settings';
import { TradePage } from '@renderer/pages/trade';
import { StockPickerList } from '@renderer/widgets/stock-picker-list';
import type { ReactElement, ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { PopoutApi, PopoutRoute } from '../model/use-popout-state';
import { usePopoutState } from '../model/use-popout-state';

const DIVIDER = (direction: 'horizontal' | 'vertical'): ReactElement => (
  <Separator
    style={
      direction === 'horizontal'
        ? { width: 6, background: 'var(--hts-line, rgba(0,0,0,0.08))', cursor: 'col-resize' }
        : { height: 6, background: 'var(--hts-line, rgba(0,0,0,0.08))', cursor: 'row-resize' }
    }
  />
);

interface PanelCardProps {
  title: string;
  route: PopoutRoute;
  popout: PopoutApi;
  children: ReactNode;
}

const PanelCard = ({ title, route, popout, children }: PanelCardProps): ReactElement => {
  const isOut = popout.isOpen(route);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--hts-panel-bg, #fff)',
        border: '1px solid var(--hts-line, rgba(0,0,0,0.12))',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.5rem 0.8rem',
          background: 'var(--hts-header-bg, rgba(0,0,0,0.04))',
          borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
          fontWeight: 600,
          fontSize: '1.15rem',
        }}
      >
        <span>{title}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hts-btn"
          onClick={() => {
            void popout.popout(route);
          }}
          aria-label={`${title} 팝아웃`}
          title="팝아웃 창으로 분리"
        >
          {isOut ? '⤢ 창 전환됨' : '⤢ 팝아웃'}
        </button>
      </div>
      <div className="panel-card-body">
        {isOut ? (
          <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>
            현재 이 화면은 팝아웃 창에서 표시 중입니다.
            <br />
            창을 닫으면 여기로 복귀합니다.
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

/**
 * HTS 스타일 분할 화면 워크스페이스.
 * 좌측 Dashboard + 우측 Trade/Logs 수직 분할. 각 패널 헤더의 "팝아웃" 버튼으로 별도 창 분리.
 * Reports/Settings 팝아웃 진입은 AppShell 헤더 쪽에 배치.
 */
export const PanelWorkspace = (): ReactElement => {
  const popout = usePopoutState();

  const panelStyle = { overflow: 'hidden' } as const;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Group orientation="vertical">
        <Panel defaultSize={40} minSize={20} style={panelStyle}>
          <Group orientation="horizontal">
            <Panel defaultSize={55} minSize={25} style={panelStyle}>
              <PanelCard title="대시보드" route="dashboard" popout={popout}>
                <DashboardPage />
              </PanelCard>
            </Panel>
            {DIVIDER('horizontal')}
            <Panel defaultSize={45} minSize={20} style={panelStyle}>
              <PanelCard title="이벤트 로그" route="logs" popout={popout}>
                <LogsPage />
              </PanelCard>
            </Panel>
          </Group>
        </Panel>
        {DIVIDER('vertical')}
        <Panel defaultSize={60} minSize={30} style={panelStyle}>
          <PanelCard title="주문" route="trade" popout={popout}>
            <TradePage />
          </PanelCard>
        </Panel>
      </Group>
    </div>
  );
};

export function readPopoutRoute(): PopoutRoute | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const match = /popout=([^&]+)/.exec(hash);
  if (!match) return null;
  const decoded = decodeURIComponent(match[1] ?? '');
  return isPopoutRoute(decoded) ? decoded : null;
}

function isPopoutRoute(v: string): v is PopoutRoute {
  return (
    v === 'dashboard' ||
    v === 'trade' ||
    v === 'logs' ||
    v === 'reports' ||
    v === 'settings' ||
    v === 'stock-picker'
  );
}

export const PopoutPage = ({ route }: { route: PopoutRoute }): ReactElement => {
  return (
    <div style={{ padding: '1rem', height: '100vh', overflow: 'auto' }}>
      {route === 'dashboard' ? (
        <DashboardPage />
      ) : route === 'trade' ? (
        <TradePage />
      ) : route === 'logs' ? (
        <LogsPage />
      ) : route === 'reports' ? (
        <ReportsPage />
      ) : route === 'stock-picker' ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <StockPickerList
            hidePopoutButton
            alwaysOpen
            onSelect={(entry) => {
              window.appShell?.assignStock?.(entry.pdno, entry.name);
            }}
          />
        </div>
      ) : (
        <SettingsPage />
      )}
    </div>
  );
};
