import { DashboardPage } from '@renderer/pages/dashboard';
import { LogsPage } from '@renderer/pages/logs';
import { TradePage } from '@renderer/pages/trade';
import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { ExternalLink } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

const DIVIDER = (direction: 'horizontal' | 'vertical'): ReactElement => (
  <Separator
    className="resize-separator"
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
  /** 헤더 title 우측(팝아웃 버튼 왼쪽)에 달 수 있는 부가 표시 — PROD 배지 등. */
  titleAccessory?: ReactNode;
}

const PanelCard = ({
  title,
  route,
  popout,
  children,
  titleAccessory,
}: PanelCardProps): ReactElement => {
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
        {titleAccessory}
        <span style={{ flex: 1 }} />
        <Button
          onClick={() => {
            void popout.popout(route);
          }}
          aria-label={`${title} 팝아웃`}
          title="팝아웃 창으로 분리"
          iconLeading={<ExternalLink size={14} />}
          dense
          variant={isOut ? 'primary' : 'default'}
        >
          {isOut ? '열린 창 보기' : '팝아웃'}
        </Button>
      </div>
      <div className="panel-card-body">{children}</div>
    </div>
  );
};

export interface PanelWorkspaceProps {
  popout: PopoutApi;
}

export const PanelWorkspace = ({ popout }: PanelWorkspaceProps): ReactElement => {
  const panelStyle = { overflow: 'hidden' } as const;

  const outer = useDefaultLayout({
    id: 'split-stock.layout.workspace.outer',
    storage: localStorage,
  });
  const topRow = useDefaultLayout({
    id: 'split-stock.layout.workspace.topRow',
    storage: localStorage,
  });

  // PROD 배지는 즉시주문 헤더 대신 "주문" 패널카드 타이틀 우측에 — 폼 안에서
  // 뜨고 사라지면서 발생하던 레이아웃 흔들림을 카드 바깥으로 격리.
  const envQuery = trpc.auth.getEnv.useQuery();
  const tradeTitleAccessory =
    envQuery.data?.env === 'PROD' ? (
      <span className="chip chip--down" style={{ fontSize: '0.85rem', padding: '0 0.4rem' }}>
        PROD
      </span>
    ) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Group
        orientation="vertical"
        defaultLayout={outer.defaultLayout}
        onLayoutChanged={outer.onLayoutChanged}
      >
        <Panel id="top-row" defaultSize={40} minSize={20} style={panelStyle}>
          <Group
            orientation="horizontal"
            defaultLayout={topRow.defaultLayout}
            onLayoutChanged={topRow.onLayoutChanged}
          >
            <Panel id="dashboard" defaultSize={55} minSize={25} style={panelStyle}>
              <PanelCard title="대시보드" route="dashboard" popout={popout}>
                <DashboardPage />
              </PanelCard>
            </Panel>
            {DIVIDER('horizontal')}
            <Panel id="logs" defaultSize={45} minSize={20} style={panelStyle}>
              <PanelCard title="이벤트 로그" route="logs" popout={popout}>
                <LogsPage />
              </PanelCard>
            </Panel>
          </Group>
        </Panel>
        {DIVIDER('vertical')}
        <Panel id="trade" defaultSize={60} minSize={30} style={panelStyle}>
          <PanelCard
            title="주문"
            route="trade"
            popout={popout}
            titleAccessory={tradeTitleAccessory}
          >
            <TradePage
              isStockPickerPopoutOpen={popout.isOpen('stock-picker')}
              onOpenStockPickerPopout={() => popout.popout('stock-picker')}
            />
          </PanelCard>
        </Panel>
      </Group>
    </div>
  );
};
