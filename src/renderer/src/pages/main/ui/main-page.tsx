import { useActiveAccountId } from '@renderer/entities/account';
import { MainPositionsPane } from '@renderer/widgets/main-positions-pane';
import { MainTradeHistoryPane } from '@renderer/widgets/main-trade-history-pane';
import type { ReactElement } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
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

const panelStyle = { overflow: 'hidden' } as const;

/**
 * 메인 페이지 — 좌(포지션/자동감시) / 우(매매내역) 좌우 resizable split.
 *
 * - 좌측 60% (min 35%) : MainPositionsGridPane
 * - 우측 40% (min 25%) : MainTradeHistoryPane
 * - 좌/우는 `selectedPdno` 단일 source 로 연결 — 좌측에서 종목 선택 시 우측이
 *   자동으로 해당 종목 매매내역으로 필터.
 * - activeAccountId 없으면 안내 패널만 표시 (login 화면을 따로 두지 않고 shell 레벨).
 */
export const MainPage = (): ReactElement => {
  const { accountId, isPending: isAccountPending } = useActiveAccountId();
  const { selectedPdno, setSelectedPdno } = useMainSelection();

  const layout = useDefaultLayout({
    id: 'split-stock.layout.main.split',
    storage: localStorage,
  });

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
    </div>
  );
};
