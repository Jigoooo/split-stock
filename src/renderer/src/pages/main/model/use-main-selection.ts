import { useState, useTransition } from 'react';

export interface UseMainSelectionResult {
  selectedPdno: string | null;
  isPending: boolean;
  setSelectedPdno: (pdno: string | null) => void;
}

/**
 * 메인 페이지의 좌/우 split 사이에서 공유되는 단일 selectedPdno source.
 *
 * 좌측 PositionsGrid 의 선택이 우측 TradeHistoryPanel 의 pdno 필터로 흐르며,
 * 우측 query refetch 가 좌측 클릭 피드백을 막지 않도록 setSelectedPdno 는
 * useTransition 으로 deferred — 좌측 row highlight 는 즉시, 우측은 다음 frame.
 */
export function useMainSelection(): UseMainSelectionResult {
  const [selectedPdno, setSelectedPdnoRaw] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const setSelectedPdno = (next: string | null): void => {
    startTransition(() => setSelectedPdnoRaw(next));
  };

  return { isPending, selectedPdno, setSelectedPdno };
}
