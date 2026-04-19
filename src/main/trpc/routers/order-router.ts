import { KisOrderAmendRequestSchema, KisOrderRequestSchema } from '@shared/contracts';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../../db/schema';
import { cancelOrRevise, orderCash } from '../../kis/order';
import { requireAccountId, resolveAccountId } from '../router-helpers';
import { authedProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive();

export const orderRouter = router({
  /**
   * 즉시 매수/매도 주문 — 매직스플릿의 수동(직접) 주문 경로.
   * 안전장치:
   *   - PROD에서는 호출측이 확인 모달을 거쳐야 한다 (renderer 책임).
   *   - accountId 명시 필수 — 활성 계좌 fallback 거부 (다른 계좌 자금 잘못 거래 방지).
   * 성공 시 orders 테이블에 PENDING으로 기록.
   */
  placeCash: authedProcedure
    .input(KisOrderRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const credResult = ctx.credentialsRepo.loadCredentials(accountId);
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
      // 안전 스위치 체크: 해당 계좌의 SafetyState 만 확인 (per-account 격리).
      const safety = ctx.safetyRegistry.get(accountId);
      if (!safety.canTrade(input.pdno)) {
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
          accountId,
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
   * 주문 정정/취소 — accountId 명시 필수.
   */
  amend: authedProcedure
    .input(KisOrderAmendRequestSchema.and(z.object({ accountId: AccountIdField })))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const credResult = ctx.credentialsRepo.loadCredentials(accountId);
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
      // 취소 성공 시 기존 order 상태를 CANCELLED로 (계좌 한정).
      if (input.action === 'cancel') {
        ctx.db
          .update(orders)
          .set({ status: 'CANCELLED' })
          .where(and(eq(orders.odno, input.orgOdno), eq(orders.accountId, accountId)))
          .run();
      }
      return result.value;
    }),

  /**
   * 미체결 주문 목록 (PENDING/PARTIAL) — 활성 계좌 한정.
   */
  listActive: authedProcedure
    .input(z.object({ accountId: AccountIdField.optional() }).optional())
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      const rows = ctx.db
        .select()
        .from(orders)
        .where(and(eq(orders.accountId, accountId), inArray(orders.status, ['PENDING', 'PARTIAL'])))
        .orderBy(asc(orders.placedAt))
        .all();
      return { orders: rows };
    }),

  /**
   * 선택 주문 일괄 취소 — accountId 명시 필수. 호가창 UI에서 호출.
   */
  cancelMany: authedProcedure
    .input(z.object({ odnos: z.array(z.string()).min(1).max(50), accountId: AccountIdField }))
    .mutation(async ({ ctx, input }) => {
      const env = ctx.currentEnv;
      if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
      const accountId = requireAccountId(input);
      const rows = ctx.db
        .select()
        .from(orders)
        .where(and(inArray(orders.odno, input.odnos), eq(orders.accountId, accountId)))
        .all();
      const credResult = ctx.credentialsRepo.loadCredentials(accountId);
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
          ctx.db
            .update(orders)
            .set({ status: 'CANCELLED' })
            .where(and(eq(orders.odno, row.odno), eq(orders.accountId, accountId)))
            .run();
          results.push({ odno: row.odno, ok: true });
        } else {
          results.push({ odno: row.odno, ok: false, reason: r.error.msg });
        }
      }
      return { results };
    }),
});
