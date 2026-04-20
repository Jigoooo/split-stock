import { trpc } from '@renderer/shared/api/trpc';
import { startTransition, useState } from 'react';

export interface UseEditLotsResult {
  // 모드 상태
  mode: boolean;
  enterMode: (accountId: number) => Promise<void>;
  exitMode: () => void;
  // 선택된 종목
  pdno: string | null;
  setPdno: (v: string | null) => void;
  // 진행/에러
  busy: boolean;
  lastError: string | null;
  clearError: () => void;
}

/**
 * 수동편집 모드 토글 훅 — 모드 enter 는 서버에 audit 만 남기고 클라이언트가 모드 상태 보유.
 * (서버 측 mode 상태 없음 — 매 mutation 이 독립적으로 safety.master OFF 검증)
 */
export function useEditLots(): UseEditLotsResult {
  const [mode, setMode] = useState(false);
  const [pdno, setPdnoRaw] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const enterMutation = trpc.lotsManual.enterMode.useMutation();

  const enterMode = async (accountId: number): Promise<void> => {
    setLastError(null);
    try {
      await enterMutation.mutateAsync({ accountId, confirm: 'EDIT' });
      setMode(true);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const exitMode = (): void => {
    startTransition(() => {
      setMode(false);
      setPdnoRaw(null);
    });
  };

  const setPdno = (v: string | null): void => {
    startTransition(() => {
      setPdnoRaw(v);
    });
  };

  return {
    mode,
    enterMode,
    exitMode,
    pdno,
    setPdno,
    busy: enterMutation.isPending,
    lastError,
    clearError: () => setLastError(null),
  };
}
