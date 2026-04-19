import { DashboardPage } from '@renderer/pages/dashboard';
import { LogsPage } from '@renderer/pages/logs';
import { ReportsPage } from '@renderer/pages/reports';
import { SettingsPage } from '@renderer/pages/settings';
import { TradePage } from '@renderer/pages/trade';
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
      <div style={{ flex: 1, overflow: 'auto', padding: '0.8rem' }}>
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

export interface PanelWorkspaceProps {
  renderExtraPopouts?: (popout: PopoutApi) => ReactNode;
}

/**
 * HTS 스타일 분할 화면 워크스페이스.
 * 좌측 Dashboard + 우측 Trade/Logs 수직 분할. 각 패널 헤더의 "팝아웃" 버튼으로 별도 창 분리.
 * Reports/Settings는 팝아웃 전용 — 상단 툴바에서 호출.
 */
export const PanelWorkspace = ({ renderExtraPopouts }: PanelWorkspaceProps): ReactElement => {
  const popout = usePopoutState();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '1.1rem' }}>
          팝아웃 전용
        </span>
        <button
          type="button"
          className="hts-btn"
          onClick={() => {
            void popout.popout('reports');
          }}
          aria-pressed={popout.isOpen('reports')}
        >
          📊 리포트 {popout.isOpen('reports') ? '(열림)' : ''}
        </button>
        <button
          type="button"
          className="hts-btn"
          onClick={() => {
            void popout.popout('settings');
          }}
          aria-pressed={popout.isOpen('settings')}
        >
          ⚙ 설정 {popout.isOpen('settings') ? '(열림)' : ''}
        </button>
        {renderExtraPopouts?.(popout)}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Group orientation="horizontal">
          <Panel defaultSize={42} minSize={25}>
            <PanelCard title="대시보드" route="dashboard" popout={popout}>
              <DashboardPage />
            </PanelCard>
          </Panel>
          {DIVIDER('horizontal')}
          <Panel defaultSize={58} minSize={30}>
            <Group orientation="vertical">
              <Panel defaultSize={62} minSize={25}>
                <PanelCard title="주문" route="trade" popout={popout}>
                  <TradePage />
                </PanelCard>
              </Panel>
              {DIVIDER('vertical')}
              <Panel defaultSize={38} minSize={20}>
                <PanelCard title="로그" route="logs" popout={popout}>
                  <LogsPage />
                </PanelCard>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
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
  return v === 'dashboard' || v === 'trade' || v === 'logs' || v === 'reports' || v === 'settings';
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
      ) : (
        <SettingsPage />
      )}
    </div>
  );
};
