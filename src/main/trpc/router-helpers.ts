import { TRPCError } from '@trpc/server';
import type { Context } from './context';

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
