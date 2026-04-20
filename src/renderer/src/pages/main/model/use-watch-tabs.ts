import type { WatchTabKey } from '@renderer/entities/watch-order';
import { useState, useTransition } from 'react';

export interface UseWatchTabsResult {
  tab: WatchTabKey;
  isPending: boolean;
  setTab: (next: WatchTabKey) => void;
}

/**
 * watch-board 4탭 상태 — 현황/실행내역/실패/히스토리.
 * 탭 변경은 useTransition 으로 deferred — 큰 리스트 재렌더 중에도 클릭 즉시 피드백.
 */
export function useWatchTabs(initial: WatchTabKey = 'watching'): UseWatchTabsResult {
  const [tab, setTabRaw] = useState<WatchTabKey>(initial);
  const [isPending, startTransition] = useTransition();

  const setTab = (next: WatchTabKey): void => {
    startTransition(() => setTabRaw(next));
  };

  return { isPending, setTab, tab };
}
