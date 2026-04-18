import { KisOrderAmendRequestSchema, KisOrderRequestSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../../db/schema';
import { cancelOrRevise, orderCash } from '../../kis/order';
import { authedProcedure, router } from '../trpc-core';

export const orderRouter = router({
  /**
   * 즉시 매수/매도 주문 — 매직스플릿의 수동(직접) 주문 경로.
   * 안전장치: PROD에서는 호출측이 확인 모달을 거쳐야 한다 (renderer 책임).
   * 성공 시 orders 테이블에 PENDING으로 기록.
   */
  placeCash: authedProcedure.input(KisOrderRequestSchema).mutation(async ({ ctx, input }) => {
    const env = ctx.currentEnv;
    if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
    const credResult = ctx.credentialsRepo.loadCredentials(env);
    if (credResult.isErr() || !credResult.value) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
    }
    const cred = credResult.value;
    const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
    if (tokenResult.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `토큰 발급 실패: ${tokenResult.error.kind}`,
      });
    }
    // 안전 스위치 체크: canTrade
    if (!ctx.safety.canTrade(input.pdno)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '안전 스위치에 의해 해당 종목 거래가 차단됨',
      });
    }
    const result = await orderCash(
      {
        http: ctx.httpByEnv[env],
        env,
        token: tokenResult.value.token,
        appKey: cred.appKey,
        appSecret: cred.appSecret,
        accountNo8: cred.accountNo8,
        accountProdCd: cred.accountProdCd,
        logger: ctx.logger,
      },
      input,
    );
    if (result.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `주문 실패: ${result.error.kind} - ${result.error.msg}`,
      });
    }
    // PENDING 기록 — orgNo는 정정/취소 시 필수이므로 KIS 응답값을 저장
    const now = new Date();
    ctx.db
      .insert(orders)
      .values({
        accountId: 1,
        lotId: null,
        odno: result.value.odno,
        orgNo: result.value.orgNo ?? null,
        pdno: input.pdno,
        side: input.side,
        division: input.division,
        qty: input.qty,
        price: input.price,
        status: 'PENDING',
        placedAt: now,
      })
      .run();
    return result.value;
  }),

  /**
   * 주문 정정/취소.
   */
  amend: authedProcedure.input(KisOrderAmendRequestSchema).mutation(async ({ ctx, input }) => {
    const env = ctx.currentEnv;
    if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
    const credResult = ctx.credentialsRepo.loadCredentials(env);
    if (credResult.isErr() || !credResult.value) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
    }
    const cred = credResult.value;
    const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
    if (tokenResult.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `토큰 발급 실패: ${tokenResult.error.kind}`,
      });
    }
    const result = await cancelOrRevise(
      {
        http: ctx.httpByEnv[env],
        env,
        token: tokenResult.value.token,
        appKey: cred.appKey,
        appSecret: cred.appSecret,
        accountNo8: cred.accountNo8,
        accountProdCd: cred.accountProdCd,
        logger: ctx.logger,
      },
      input,
    );
    if (result.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `주문 정정/취소 실패: ${result.error.kind}`,
      });
    }
    // 취소 성공 시 기존 order 상태를 CANCELLED로
    if (input.action === 'cancel') {
      ctx.db
        .update(orders)
        .set({ status: 'CANCELLED' })
        .where(eq(orders.odno, input.orgOdno))
        .run();
    }
    return result.value;
  }),

  /**
   * 미체결 주문 목록 (PENDING/PARTIAL).
   */
  listActive: authedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select()
      .from(orders)
      .where(inArray(orders.status, ['PENDING', 'PARTIAL']))
      .orderBy(asc(orders.placedAt))
      .all();
    return { orders: rows };
  }),

  /**
   * 선택 주문 일괄 취소 — 호가창 UI에서 호출.
   */
  cancelMany: authedProcedure
    .input(z.object({ odnos: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const rows = ctx.db.select().from(orders).where(inArray(orders.odno, input.odnos)).all();
      const credResult = ctx.credentialsRepo.loadCredentials(env);
      if (credResult.isErr() || !credResult.value) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
      }
      const cred = credResult.value;
      const tokenResult = await ctx.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `토큰 발급 실패: ${tokenResult.error.kind}`,
        });
      }
      const results: Array<{ odno: string; ok: boolean; reason?: string }> = [];
      for (const row of rows) {
        if (!row.orgNo) {
          results.push({
            odno: row.odno,
            ok: false,
            reason: 'orgNo 누락 — 정정/취소 불가 (원주문 접수 응답 확인 필요)',
          });
          continue;
        }
        const r = await cancelOrRevise(
          {
            http: ctx.httpByEnv[env],
            env,
            token: tokenResult.value.token,
            appKey: cred.appKey,
            appSecret: cred.appSecret,
            accountNo8: cred.accountNo8,
            accountProdCd: cred.accountProdCd,
            logger: ctx.logger,
          },
          {
            action: 'cancel',
            orgOrgNo: row.orgNo,
            orgOdno: row.odno,
            division: row.division as 'LIMIT' | 'MARKET',
            qty: row.qty,
            price: 0,
            qtyAllOrder: true,
          },
        );
        if (r.isOk()) {
          ctx.db.update(orders).set({ status: 'CANCELLED' }).where(eq(orders.odno, row.odno)).run();
          results.push({ odno: row.odno, ok: true });
        } else {
          results.push({ odno: row.odno, ok: false, reason: r.error.msg });
        }
      }
      return { results };
    }),
});
