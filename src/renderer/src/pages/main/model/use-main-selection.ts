import { useState, useTransition } from 'react';

export interface UseMainSelectionResult {
  selectedPdno: string | null;
  isPending: boolean;
  setSelectedPdno: (pdno: string | null) => void;
}

const LAST_MAIN_PDNO_KEY = 'split-stock.main.last-pdno';

const readPersistedPdno = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_MAIN_PDNO_KEY);
  } catch {
    return null;
  }
};

const persistPdno = (next: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (next === null) {
      window.localStorage.removeItem(LAST_MAIN_PDNO_KEY);
    } else {
      window.localStorage.setItem(LAST_MAIN_PDNO_KEY, next);
    }
  } catch {
    // localStorage 차단/quota 등은 무시 (in-memory state로만 동작)
  }
};

/**
 * 메인 페이지의 좌/우 split 사이에서 공유되는 단일 selectedPdno source.
 *
 * 종료 전 마지막 선택 종목을 localStorage에 영속하여 재시작 시 자동 복원.
 * 좌측 PositionsGrid 의 선택이 우측 TradeHistoryPanel 의 pdno 필터로 흐르며,
 * 우측 query refetch 가 좌측 클릭 피드백을 막지 않도록 setSelectedPdno 는
 * useTransition 으로 deferred — 좌측 row highlight 는 즉시, 우측은 다음 frame.
 */
export function useMainSelection(): UseMainSelectionResult {
  const [selectedPdno, setSelectedPdnoRaw] = useState<string | null>(readPersistedPdno);
  const [isPending, startTransition] = useTransition();

  const setSelectedPdno = (next: string | null): void => {
    persistPdno(next);
    startTransition(() => setSelectedPdnoRaw(next));
  };

  return { isPending, selectedPdno, setSelectedPdno };
}
