import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';

/**
 * tRPC 초기화. Superjson으로 Buffer/Date 직렬화 지원.
 *
 * `t` 는 라우터 단위 테스트가 `t.createCallerFactory(router)(ctx)` 패턴을 쓰기 위해 export.
 */
export const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.currentEnv) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: '환경(MOCK/PROD)이 선택되지 않았습니다',
    });
  }
  return next({ ctx });
});
