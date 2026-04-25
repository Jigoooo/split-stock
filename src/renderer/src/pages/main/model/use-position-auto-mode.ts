import { trpc } from '@renderer/shared/api/trpc';
import type { StrategyAutoMode } from '@shared/contracts/strategy';
import { useEffect, useState } from 'react';

interface SetPositionAutoModeInput {
  accountId: number;
  mode: StrategyAutoMode;
  pdno: string;
}

/**
 * 자동 컬럼 select 의 optimistic 토글 훅.
 *
 * 서버 mutation 의 `isPending` 이나 query refetch 지연을 사용자에게 노출하지 않기 위해,
 * `serverMode` (query 유래) 와 `optimisticMode` (방금 사용자가 선택한 값) 를 합쳐
 * `displayMode` 로 반환한다. 서버 응답 후 query 가 refetch 되어 같은 값이 들어오면
 * `optimisticMode` 를 클리어한다.
 *
 * caller 는 `displayMode` 를 select 의 value 로 쓰고, `setAutoMode` 만 호출하면 된다.
 * select 는 disable 하지 않는다 — 빠른 연속 변경 시 last-write-wins 로 최종 값만 반영.
 */
export function usePositionAutoMode(pdno: string, serverMode: StrategyAutoMode) {
  const utils = trpc.useUtils();
  const [optimisticMode, setOptimisticMode] = useState<StrategyAutoMode | null>(null);

  const mutation = trpc.strategy.setAutoModeQuick.useMutation({
    onSuccess: () => {
      // fire-and-forget — await 하면 무거운 getBalanceWithLots refetch 까지 isPending 잡힘.
      void utils.account.getBalanceWithLots.invalidate();
      void utils.strategy.getActive.invalidate({ pdno });
      void utils.strategy.getEffectiveForEdit.invalidate({ pdno });
    },
    onError: () => {
      // 서버 거절 → optimistic 값을 버리고 serverMode 로 복귀.
      setOptimisticMode(null);
    },
  });

  // 서버 mode 가 optimistic 값과 일치하게 되면 optimistic 종료 — 이후 query 가 진실의 원천.
  useEffect(() => {
    if (optimisticMode !== null && serverMode === optimisticMode) {
      setOptimisticMode(null);
    }
  }, [serverMode, optimisticMode]);

  const displayMode: StrategyAutoMode = optimisticMode ?? serverMode;

  const setAutoMode = (input: SetPositionAutoModeInput): void => {
    setOptimisticMode(input.mode);
    mutation.mutate(input);
  };

  return {
    displayMode,
    isPending: mutation.isPending,
    setAutoMode,
  };
}
