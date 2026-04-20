import { useActiveAccountId, useBalanceWithLots } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { MainPositionsPane } from '@renderer/widgets/main-positions-pane';
import { MainTradeHistoryPane } from '@renderer/widgets/main-trade-history-pane';
import { TradingPanel } from '@renderer/widgets/trading-panel';
import type { ReactElement } from 'react';
import { Group, type Layout, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useMainRealtime } from '../model/use-main-realtime';
import { useMainSelection } from '../model/use-main-selection';

const HORIZONTAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      width: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'col-resize',
    }}
  />
);

const VERTICAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      height: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'row-resize',
    }}
  />
);

const panelStyle = { overflow: 'hidden' } as const;

/**
 * 메인 페이지 — 상단(좌/우 split: 포지션/매매내역) + 하단(주문 섹션) vertical split.
 *
 * - 상단 70% (min 35%) :
 *     - 좌측 60% (min 35%) : MainPositionsGridPane
 *     - 우측 40% (min 25%) : MainTradeHistoryPane
 * - 하단 30% (min 25%) : TradingPanel (호가/주문/체결/미체결) — selectedPdno 기준
 * - selectedPdno 없으면 하단은 안내 메시지만 표시.
 * - activeAccountId 없으면 안내 패널만 표시 (login 화면을 따로 두지 않고 shell 레벨).
 */
export const MainPage = (): ReactElement => {
  useMainRealtime();

  const { accountId, isPending: isAccountPending } = useActiveAccountId();
  const { selectedPdno, setSelectedPdno } = useMainSelection();

  const layout = useDefaultLayout({
    id: 'split-stock.layout.main.split',
    storage: localStorage,
  });
  const verticalLayout = useDefaultLayout({
    id: 'split-stock.layout.main.vertical',
    storage: localStorage,
  });

  // 하단 TradingPanel 의 isProd / 종목명 조회 — 좌측에서 선택된 pdno 의 name 을
  // useBalanceWithLots.positions 에서 lookup, 미발견 시 pdno 자체로 fallback.
  const envQuery = trpc.auth.getEnv.useQuery();
  const isProd = envQuery.data?.env === 'PROD';
  const balance = useBalanceWithLots();
  const selectedName =
    selectedPdno !== null
      ? (balance.positions.find((p) => p.code === selectedPdno)?.name ?? selectedPdno)
      : null;

  if (isAccountPending) {
    return (
      <div
        className="muted"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.1rem',
        }}
      >
        계좌 확인 중…
      </div>
    );
  }

  if (accountId === null) {
    return (
      <div
        className="muted"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.6rem',
          fontSize: '1.1rem',
          padding: '1rem',
          textAlign: 'center',
        }}
        role="status"
      >
        <div>활성 계좌가 없습니다.</div>
        <div style={{ fontSize: '0.95rem' }}>
          상단 계좌 바에서 계좌를 추가하거나 선택하면 메인 화면이 표시됩니다.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Group
        orientation="vertical"
        defaultLayout={(verticalLayout.defaultLayout ?? [70, 30]) as Layout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
      >
        <Panel id="main-top" defaultSize={70} minSize={35} style={panelStyle}>
          <Group
            orientation="horizontal"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
          >
            <Panel id="main-left" defaultSize={60} minSize={35} style={panelStyle}>
              <MainPositionsPane
                accountId={accountId}
                selectedPdno={selectedPdno}
                onSelect={setSelectedPdno}
              />
            </Panel>
            {HORIZONTAL_SEPARATOR}
            <Panel id="main-right" defaultSize={40} minSize={25} style={panelStyle}>
              <MainTradeHistoryPane accountId={accountId} selectedPdno={selectedPdno} />
            </Panel>
          </Group>
        </Panel>
        {VERTICAL_SEPARATOR}
        <Panel id="main-bottom" defaultSize={30} minSize={20} style={panelStyle}>
          {selectedPdno !== null && selectedName !== null ? (
            <TradingPanel pdno={selectedPdno} name={selectedName} isProd={isProd} />
          ) : (
            <div
              className="muted"
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
              }}
              role="status"
            >
              상단 포지션에서 종목을 선택하면 호가창/주문 패널이 표시됩니다.
            </div>
          )}
        </Panel>
      </Group>
    </div>
  );
};
