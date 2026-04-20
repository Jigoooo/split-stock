import { useState, useTransition } from 'react';

/** L1 외부 탭 — 포지션(positions) vs 자동감시(watch). */
export type PaneL1 = 'positions' | 'watch';

/** L2 내부 탭 (positions L1 일 때만) — 실시간 잔고 / 실시간 체결 / 실시간 미체결 / 과거 거래 종목. */
export type PaneL2 = 'balance' | 'filled' | 'unfilled' | 'past';

export interface UsePaneTabsResult {
  l1: PaneL1;
  l2: PaneL2;
  isPending: boolean;
  setL1: (next: PaneL1) => void;
  setL2: (next: PaneL2) => void;
}

/**
 * main-positions-pane 의 L1/L2 탭 상태.
 * - L1: 포지션/자동감시
 * - L2: positions L1 한정 — 실시간 잔고 / 체결 / 미체결 / 과거
 *
 * 탭 변경은 useTransition 으로 deferred — 큰 그리드 재렌더 중에도 즉시 피드백.
 */
export function usePaneTabs(
  initialL1: PaneL1 = 'positions',
  initialL2: PaneL2 = 'balance',
): UsePaneTabsResult {
  const [l1, setL1Raw] = useState<PaneL1>(initialL1);
  const [l2, setL2Raw] = useState<PaneL2>(initialL2);
  const [isPending, startTransition] = useTransition();

  const setL1 = (next: PaneL1): void => {
    startTransition(() => setL1Raw(next));
  };
  const setL2 = (next: PaneL2): void => {
    startTransition(() => setL2Raw(next));
  };

  return { isPending, l1, l2, setL1, setL2 };
}
