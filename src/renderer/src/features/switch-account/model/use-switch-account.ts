import { trpc } from '@renderer/shared/api/trpc';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * 계좌 전환 mutation — `account.setActive` 호출.
 *
 * 서버 측 setActive 가:
 *   1) accounts.is_active 단일성 트랜잭션
 *   2) 대상 계좌 env 로 ctx.currentEnv 동기 (다르면 LAST_ACTIVE_ENV 영속 + realtime 재생성)
 *   3) ctx.activeAccountId 갱신
 * 까지 원자적으로 수행하므로, 클라이언트는 전역 query cache 만 invalidate 하면 된다.
 *
 * lots/safety/strategy/balance 등 모든 query 가 계좌 컨텍스트에 의존하므로 sledgehammer
 * (`qc.invalidateQueries()` 인자 없음) 가 가장 안전. 라우터 추가에 따라 invalidate 목록이
 * 드리프트하는 사고를 차단한다.
 */
export interface UseSwitchAccountResult {
  switchAccount: (accountId: number) => Promise<void>;
  isPending: boolean;
  error: { message: string } | null;
}

export function useSwitchAccount(): UseSwitchAccountResult {
  const qc = useQueryClient();
  const setActive = trpc.account.setActive.useMutation({
    onSuccess: async (_data, variables) => {
      // 활성 계좌 변경은 컨텍스트 자체가 바뀌므로 모든 query invalidate.
      await qc.invalidateQueries();
      // popout 윈도우들도 같은 계좌 컨텍스트를 따라가도록 broadcast.
      window.appShell?.broadcastAccountChanged?.(variables.accountId);
      window.appShell?.broadcastSettingsChanged?.('account');
      toast.success('계좌가 전환되었습니다');
    },
    onError: (err) => {
      toast.error(`계좌 전환 실패: ${err.message}`);
    },
  });

  const switchAccount = async (accountId: number): Promise<void> => {
    await setActive.mutateAsync({ accountId });
  };

  return {
    switchAccount,
    isPending: setActive.isPending,
    error: setActive.error ? { message: setActive.error.message } : null,
  };
}
