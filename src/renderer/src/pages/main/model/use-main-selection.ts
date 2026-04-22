import { useState } from 'react';

export interface MainSelectedStock {
  pdno: string;
  name: string | null;
}

export interface UseMainSelectionResult {
  selectedStock: MainSelectedStock | null;
  selectedPdno: string | null;
  isPending: boolean;
  setSelectedPdno: (pdno: string | null) => void;
  setSelectedStock: (stock: MainSelectedStock | null) => void;
}

const LAST_MAIN_PDNO_KEY = 'split-stock.main.last-pdno';

const readPersistedSelection = (): MainSelectedStock | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_MAIN_PDNO_KEY);
    if (!raw) return null;
    if (!raw.startsWith('{')) {
      return { pdno: raw, name: null };
    }
    const parsed = JSON.parse(raw) as { pdno?: unknown; name?: unknown };
    if (typeof parsed.pdno !== 'string' || parsed.pdno.length === 0) return null;
    return {
      pdno: parsed.pdno,
      name: typeof parsed.name === 'string' ? parsed.name : null,
    };
  } catch {
    return null;
  }
};

const persistSelection = (next: MainSelectedStock | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (next === null) {
      window.localStorage.removeItem(LAST_MAIN_PDNO_KEY);
    } else {
      window.localStorage.setItem(LAST_MAIN_PDNO_KEY, JSON.stringify(next));
    }
  } catch {
    // localStorage 차단/quota 등은 무시 (in-memory state로만 동작)
  }
};

/**
 * 메인 페이지의 좌/우 split 사이에서 공유되는 단일 selectedPdno source.
 *
 * 종료 전 마지막 선택 종목(pdno + 검색 결과 name)을 localStorage에 영속한다.
 * 좌측/우측/하단 주문 패널은 모두 이 selection source 를 공유한다.
 */
export function useMainSelection(): UseMainSelectionResult {
  const [selectedStock, setSelectedStockRaw] = useState<MainSelectedStock | null>(
    readPersistedSelection,
  );

  const setSelectedPdno = (next: string | null): void => {
    setSelectedStockRaw((prev) => {
      const selection =
        next === null
          ? null
          : prev?.pdno === next
            ? { pdno: next, name: prev.name }
            : { pdno: next, name: null };
      persistSelection(selection);
      return selection;
    });
  };

  const setSelectedStock = (next: MainSelectedStock | null): void => {
    persistSelection(next);
    setSelectedStockRaw(next);
  };

  return {
    selectedStock,
    selectedPdno: selectedStock?.pdno ?? null,
    isPending: false,
    setSelectedPdno,
    setSelectedStock,
  };
}
