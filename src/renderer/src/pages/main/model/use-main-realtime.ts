import { trpc } from '@renderer/shared/api/trpc';
import { useEffect } from 'react';

/**
 * 메인 페이지 마운트 시 realtime feed 를 자동 시작.
 *
 * use-trade-runtime 과 동일한 idempotent 패턴:
 *   - env 준비됐을 때만 시작 시도
 *   - `started` 가 권위 소스 — 이미 시작됐으면 noop
 *   - isPending 으로 중복 호출 가드
 *   - 서버 start 는 idempotent 이므로 trade-page 와 중복 호출해도 안전
 */
export function useMainRealtime() {
  const envQuery = trpc.auth.getEnv.useQuery();
  const activeAccountQuery = trpc.account.getActive.useQuery(undefined, {
    enabled: (envQuery.data?.env ?? null) !== null,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const envReady = (envQuery.data?.env ?? null) !== null;
  const stockRealtimeAllowed = activeAccountQuery.data?.account?.broker !== 'UPBIT';
  const realtimeStatus = trpc.realtime.status.useQuery(undefined, {
    enabled: envReady && stockRealtimeAllowed,
    refetchInterval: 5000,
  });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => realtimeStatus.refetch(),
  });

  useEffect(() => {
    if (!envReady || !stockRealtimeAllowed) return;
    if (realtimeStatus.data?.started) return;
    if (startRealtime.isPending) return;
    startRealtime.mutate();
  }, [envReady, realtimeStatus.data?.started, startRealtime, stockRealtimeAllowed]);
}
