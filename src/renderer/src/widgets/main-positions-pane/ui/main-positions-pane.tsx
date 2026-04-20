import { type HtsTabItem, HtsTabs } from '@renderer/widgets/hts-tabs';
import { PositionsGrid } from '@renderer/widgets/positions-grid';
import { WatchBoard } from '@renderer/widgets/watch-board';
import type { ReactElement } from 'react';
import { type PaneL1, type PaneL2, usePaneTabs } from '../model/use-pane-tabs';

export interface MainPositionsPaneProps {
  accountId: number;
  selectedPdno: string | null;
  onSelect: (pdno: string) => void;
}

const L1_TABS: ReadonlyArray<HtsTabItem<PaneL1>> = [
  { id: 'positions', label: '포지션' },
  { id: 'watch', label: '자동감시' },
];

const L2_TABS: ReadonlyArray<HtsTabItem<PaneL2>> = [
  { id: 'balance', label: '실시간 잔고' },
  { id: 'filled', label: '실시간 체결' },
  { id: 'unfilled', label: '실시간 미체결' },
  { id: 'past', label: '과거 거래 종목' },
];

/**
 * 좌측 메인 패널 — 외부(L1) + 내부(L2) 2-level 탭 컨테이너.
 *
 * - L1=포지션 → L2 4탭 + 선택된 L2에 따라 컨텐트 마운트.
 *   본 wave 는 L2='balance' 만 PositionsGrid 마운트, 나머지 L2 는 placeholder.
 * - L1=자동감시 → WatchBoard 마운트 (L2 없음).
 */
export const MainPositionsPane = (props: MainPositionsPaneProps): ReactElement => {
  const { accountId, onSelect, selectedPdno } = props;
  const { l1, l2, setL1, setL2 } = usePaneTabs();

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label="좌측 메인 패널"
    >
      <HtsTabs tabs={L1_TABS} active={l1} onChange={setL1} ariaLabel="좌측 외부 탭" />

      {l1 === 'positions' ? (
        <>
          <HtsTabs tabs={L2_TABS} active={l2} onChange={setL2} ariaLabel="좌측 포지션 내부 탭" />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {l2 === 'balance' ? (
              <PositionsGrid
                accountId={accountId}
                selectedPdno={selectedPdno}
                onSelect={onSelect}
              />
            ) : (
              <Placeholder label={`${labelOf(l2)} 탭 — Wave 5 에서 구현`} />
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <WatchBoard accountId={accountId} />
        </div>
      )}
    </section>
  );
};

function labelOf(l2: PaneL2): string {
  const found = L2_TABS.find((t) => t.id === l2);
  return found ? found.label : String(l2);
}

const Placeholder = ({ label }: { label: string }): ReactElement => (
  <div className="muted" style={{ padding: '1rem', fontSize: '1.1rem' }}>
    {label}
  </div>
);
