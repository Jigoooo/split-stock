import { useState, useTransition } from 'react';

/**
 * trade-history-panel 의 R2 5탭 상태 관리.
 *  - 'all'      : 전체보기 (진행중 + 종료)
 *  - 'open'     : 진행중 사이클
 *  - 'closed'   : 종료 사이클
 *  - 'strategy' : 자동매매 설정 (features/edit-strategy 마운트)
 *  - 'memo'     : 종목메모 (features/symbol-memo 마운트)
 *
 * 탭 변경은 useTransition 으로 deferred — 대용량 사이클 리스트 재렌더 중에도
 * 클릭 즉시 피드백 유지.
 */
export type TradeHistoryTabKey = 'all' | 'open' | 'closed' | 'strategy' | 'memo';

export interface UseTradeHistoryTabsResult {
  tab: TradeHistoryTabKey;
  isPending: boolean;
  setTab: (next: TradeHistoryTabKey) => void;
}

export function useTradeHistoryTabs(
  initial: TradeHistoryTabKey = 'all',
): UseTradeHistoryTabsResult {
  const [tab, setTabRaw] = useState<TradeHistoryTabKey>(initial);
  const [isPending, startTransition] = useTransition();

  const setTab = (next: TradeHistoryTabKey): void => {
    startTransition(() => setTabRaw(next));
  };

  return { isPending, setTab, tab };
}
