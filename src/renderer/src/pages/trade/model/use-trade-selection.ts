import { useEffect, useEffectEvent, useState } from 'react';

interface Selected {
  pdno: string;
  name: string;
}

const LAST_SELECTED_KEY = 'trade.lastSelected';

function readLastSelected(): Selected | null {
  try {
    const raw = window.localStorage.getItem(LAST_SELECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Selected).pdno === 'string' &&
      typeof (parsed as Selected).name === 'string' &&
      /^\d{6}$/.test((parsed as Selected).pdno)
    ) {
      return parsed as Selected;
    }
  } catch {
    // JSON 파싱 실패 등 무시
  }
  return null;
}

export function useTradeSelection() {
  const [selected, setSelectedState] = useState<Selected | null>(() => readLastSelected());

  const persistSelection = (next: Selected | null): void => {
    setSelectedState(next);
    try {
      if (next) {
        window.localStorage.setItem(LAST_SELECTED_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(LAST_SELECTED_KEY);
      }
    } catch {
      // storage 쿼터/권한 문제 무시 — 세션 내 동작엔 영향 없음
    }
  };

  const onAssigned = useEffectEvent((pdno: string, name: string) => {
    persistSelection({ pdno, name });
  });

  useEffect(() => {
    const shell = window.appShell;
    if (!shell) return;
    return shell.onStockAssigned((pdno, name) => {
      onAssigned(pdno, name);
    });
  }, []);

  return {
    selected,
    setSelected: persistSelection,
  };
}
