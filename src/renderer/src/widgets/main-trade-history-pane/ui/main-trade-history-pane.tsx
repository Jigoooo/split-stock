import { type HtsTabItem, HtsTabs } from '@renderer/widgets/hts-tabs';
import { TradeHistoryPanel } from '@renderer/widgets/trade-history-panel';
import { type ReactElement, useState, useTransition } from 'react';

export interface MainTradeHistoryPaneProps {
  accountId: number;
  /** 좌측에서 선택된 종목. null 이면 외부 R1 탭은 "모든 매매내역" 한 개만. */
  selectedPdno: string | null;
}

type R1 = 'symbol' | 'all';

/**
 * 우측 매매내역 컨테이너 — 외부(R1) + 내부(R2 5탭 = TradeHistoryPanel) 2-level.
 *
 * R1 외부 탭:
 *   - selectedPdno !== null → ['선택종목 매매내역(pdno)', '모든 매매내역']
 *   - selectedPdno === null → ['모든 매매내역'] 한 개
 *
 * 선택된 R1 에 따라 TradeHistoryPanel 의 pdno prop 이 바뀜:
 *   - 'symbol' → selectedPdno
 *   - 'all'    → null (전체 사이클)
 */
export const MainTradeHistoryPane = (props: MainTradeHistoryPaneProps): ReactElement => {
  const { accountId, selectedPdno } = props;
  const [r1, setR1Raw] = useState<R1>(selectedPdno !== null ? 'symbol' : 'all');
  const [, startTransition] = useTransition();
  const setR1 = (next: R1): void => {
    startTransition(() => setR1Raw(next));
  };

  // selectedPdno 가 null 이면 'symbol' 탭은 의미 없으므로 'all' 강제.
  const effectiveR1: R1 = selectedPdno === null ? 'all' : r1;

  const tabs: ReadonlyArray<HtsTabItem<R1>> =
    selectedPdno !== null
      ? [
          { id: 'symbol', label: `선택종목 매매내역 (${selectedPdno})` },
          { id: 'all', label: '모든 매매내역' },
        ]
      : [{ id: 'all', label: '모든 매매내역' }];

  const pdnoForPanel = effectiveR1 === 'symbol' ? selectedPdno : null;

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label="우측 매매내역 패널"
    >
      <HtsTabs tabs={tabs} active={effectiveR1} onChange={setR1} ariaLabel="우측 외부 탭" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TradeHistoryPanel accountId={accountId} pdno={pdnoForPanel} />
      </div>
    </section>
  );
};
