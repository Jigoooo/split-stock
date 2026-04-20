import { type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import { type ReactElement, useState, useTransition } from 'react';
import { AllTradeHistoryPanel } from './all-trade-history-panel';
import { TradeHistoryPanel } from './trade-history-panel';

export interface MainTradeHistoryPaneProps {
  accountId: number;
  /** 좌측에서 선택된 종목. null 이면 외부 R1 탭은 "모든 매매내역" 한 개만. */
  selectedPdno: string | null;
  selectedName?: string | null;
}

type R1 = 'symbol' | 'all';

/**
 * 우측 매매내역 컨테이너 — 외부(R1) + 컨텐츠 분기.
 *
 * R1 외부 탭:
 *   - selectedPdno !== null → ['종목명(pdno) 매매내역', '모든 매매내역']
 *   - selectedPdno === null → ['모든 매매내역'] 한 개
 *
 * 선택된 R1 에 따라 렌더 대상이 바뀐다:
 *   - 'symbol' → TradeHistoryPanel(selectedPdno)
 *   - 'all'    → AllTradeHistoryPanel (전용 화면)
 */
export const MainTradeHistoryPane = (props: MainTradeHistoryPaneProps): ReactElement => {
  const { accountId, selectedName = null, selectedPdno } = props;
  const [r1, setR1Raw] = useState<R1>(selectedPdno !== null ? 'symbol' : 'all');
  const [, startTransition] = useTransition();
  const setR1 = (next: R1): void => {
    startTransition(() => setR1Raw(next));
  };

  // selectedPdno 가 null 이면 'symbol' 탭은 의미 없으므로 'all' 강제.
  const effectiveR1: R1 = selectedPdno === null ? 'all' : r1;

  const symbolTradeTabLabel =
    selectedPdno === null
      ? null
      : selectedName !== null && selectedName !== selectedPdno
        ? `${selectedName}(${selectedPdno}) 매매내역`
        : `${selectedPdno} 매매내역`;

  const tabs: ReadonlyArray<HtsTabItem<R1>> =
    selectedPdno !== null
      ? [
          { id: 'symbol', label: symbolTradeTabLabel ?? `${selectedPdno} 매매내역` },
          { id: 'all', label: '모든 매매내역' },
        ]
      : [{ id: 'all', label: '모든 매매내역' }];

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
        {effectiveR1 === 'all' ? (
          <AllTradeHistoryPanel accountId={accountId} />
        ) : (
          <TradeHistoryPanel accountId={accountId} pdno={selectedPdno} />
        )}
      </div>
    </section>
  );
};
