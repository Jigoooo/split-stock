import type { AppEnv } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import type { Context } from './context';

/**
 * env 전환 직후 프론트의 inflight/cached useQuery 가 이전 env 의 accountId 를
 * input 으로 담고 도달하는 레이스 방어. 그 accountId 로 load 한 cred 의 env 가
 * 현재 env 와 어긋나면 KIS 에 교차 호출을 내보내기 전에 친화 메시지로 차단.
 *
 * 이 가드가 발동하면 프론트의 refetch 파이프라인이 새 env 기준으로 재발행 된
 * 뒤 자연 복구된다. 실제 자격증명/토큰 문제와 구분되는 PRECONDITION_FAILED 사용.
 */
export function assertCredMatchesEnv(cred: { env: AppEnv }, currentEnv: AppEnv): void {
  if (cred.env !== currentEnv) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '환경 전환 중입니다. 잠시 후 다시 시도해주세요.',
    });
  }
}

/**
 * 라우터 입력의 accountId 를 활성 계좌로 fallback.
 * 읽기 query 에 적합. 거래성 mutation 에는 `requireAccountId` 사용 권장.
 */
export function resolveAccountId(
  ctx: Context,
  input: { accountId?: number | null | undefined },
): number {
  const explicit = input.accountId;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const active = ctx.activeAccountId;
  if (active === null) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '활성 계좌가 없습니다. 자격증명을 먼저 등록하세요.',
    });
  }
  return active;
}

/**
 * 거래성 mutation 용 — accountId 가 명시되지 않으면 무조건 거부.
 * "다른 계좌 자금 잘못 거래" 사고 방지용 가드.
 */
export function requireAccountId(input: { accountId?: number | null | undefined }): number {
  const explicit = input.accountId;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: '거래성 호출은 accountId 를 명시해야 합니다.',
  });
}
