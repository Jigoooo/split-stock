import {
  applyStrategyAutoMode,
  type StrategyAutoMode,
  StrategyProfileSchema,
} from '@shared/contracts/strategy';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { applyPriceRatio } from '../../trading/respiit-planner';
import type { Context } from '../context';
import { resolveAccountId } from '../router-helpers';
import { publicProcedure, router } from '../trpc-core';

const AccountIdField = z.number().int().positive().optional();

const ActiveSelectorSchema = z.object({
  pdno: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
  accountId: AccountIdField,
});

const PresetNameSchema = z.object({
  name: z.string().min(1).max(50),
  accountId: AccountIdField,
});

function requestImmediateStrategyEvaluation(
  ctx: Context,
  accountId: number,
  pdno: string | null,
): void {
  const engine = ctx.strategyEngine;
  if (!engine) return;
  if (ctx.activeAccountId !== accountId) return;
  engine.refreshTrackedSymbols();
  if (pdno) {
    engine.evaluateLatest(pdno);
    return;
  }
  engine.evaluateLatestForTracked();
}

export const strategyRouter = router({
  getActive: publicProcedure.input(ActiveSelectorSchema).query(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    const r = ctx.strategyRepo.getActive(accountId, input.pdno);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `전략 로드 실패: ${r.error.kind}`,
      });
    }
    return { profile: r.value };
  }),

  getEffectiveForEdit: publicProcedure.input(ActiveSelectorSchema).query(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    const r = ctx.strategyRepo.getEffectiveForEdit(accountId, input.pdno);
    if (r.isErr()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `전략 로드 실패: ${r.error.kind}`,
      });
    }
    return {
      effectiveProfile: r.value.profile,
      source: r.value.source,
      hasOverride: r.value.hasOverride,
    };
  }),

  getEffectiveMetas: publicProcedure
    .input(
      z.object({
        accountId: AccountIdField,
        pdnos: z.array(z.string().regex(/^\d{6}$/)).max(200),
      }),
    )
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const uniquePdnos = Array.from(new Set(input.pdnos)).sort((a, b) => a.localeCompare(b));
      const strategiesByPdno: Record<
        string,
        { maxStages: number; autoBuyEnabled: boolean; autoSellEnabled: boolean }
      > = {};

      for (const pdno of uniquePdnos) {
        const effective = ctx.strategyRepo.getEffectiveForEdit(accountId, pdno);
        if (effective.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `전략 메타 로드 실패: ${effective.error.kind}`,
          });
        }
        strategiesByPdno[pdno] = {
          maxStages: effective.value.profile.maxStages,
          autoBuyEnabled: effective.value.profile.autoBuyEnabled,
          autoSellEnabled: effective.value.profile.autoSellEnabled,
        };
      }

      return { strategiesByPdno };
    }),

  setActive: publicProcedure
    .input(ActiveSelectorSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const r = ctx.strategyRepo.setActive(accountId, input.pdno, input.profile);
      if (r.isErr()) {
        throw new TRPCError({
          code: r.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: `전략 저장 실패: ${r.error.kind}`,
        });
      }
      if (input.pdno === null) {
        ctx.strategyRepo.applyAutoControlsToSymbolActives(accountId, {
          autoBuyEnabled: input.profile.autoBuyEnabled,
          autoBuyOrderType: input.profile.autoBuyOrderType,
          autoSellEnabled: input.profile.autoSellEnabled,
          autoSellOrderType: input.profile.autoSellOrderType,
        });
      }
      requestImmediateStrategyEvaluation(ctx, accountId, input.pdno);
      return { ok: true as const };
    }),

  setAutoModeQuick: publicProcedure
    .input(
      ActiveSelectorSchema.extend({
        pdno: z.string().regex(/^\d{6}$/),
        mode: z.enum(['ALL_ON', 'ALL_OFF', 'BUY_ONLY', 'SELL_ONLY']),
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const seeded = ctx.strategyRepo.ensureSeededActive(accountId, input.pdno);
      if (seeded.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `자동매매 상태 변경 실패: ${seeded.error.kind}`,
        });
      }
      const nextProfile = applyStrategyAutoMode(
        seeded.value.profile,
        input.mode as StrategyAutoMode,
      );
      const saveResult = ctx.strategyRepo.setActive(accountId, input.pdno, nextProfile);
      if (saveResult.isErr()) {
        throw new TRPCError({
          code: saveResult.error.kind === 'VALIDATION' ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: `자동매매 상태 저장 실패: ${saveResult.error.kind}`,
        });
      }
      requestImmediateStrategyEvaluation(ctx, accountId, input.pdno);
      return { ok: true as const, profile: nextProfile };
    }),

  clearActive: publicProcedure.input(ActiveSelectorSchema).mutation(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    ctx.strategyRepo.clearActive(accountId, input.pdno);
    requestImmediateStrategyEvaluation(ctx, accountId, input.pdno);
    return { ok: true as const };
  }),

  listPresets: publicProcedure
    .input(z.object({ accountId: AccountIdField }).optional())
    .query(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input ?? {});
      return { presets: ctx.strategyRepo.listPresets(accountId) };
    }),

  savePreset: publicProcedure
    .input(PresetNameSchema.extend({ profile: StrategyProfileSchema }))
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      const r = ctx.strategyRepo.savePreset(accountId, input.name, input.profile);
      if (r.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `프리셋 저장 실패: ${r.error.kind}` });
      }
      return { ok: true as const };
    }),

  deletePreset: publicProcedure.input(PresetNameSchema).mutation(({ ctx, input }) => {
    const accountId = resolveAccountId(ctx, input);
    ctx.strategyRepo.deletePreset(accountId, input.name);
    return { ok: true as const };
  }),

  applyPriceRatio: publicProcedure
    .input(
      z.object({
        pdno: z.string().regex(/^\d{6}$/),
        stages: z.union([z.array(z.number().int().min(1)), z.literal('all')]),
        ratioPct: z.number().min(-100).max(100),
        accountId: AccountIdField,
      }),
    )
    .mutation(({ ctx, input }) => {
      const accountId = resolveAccountId(ctx, input);
      // 현재 활성 전략 조회
      const activeResult = ctx.strategyRepo.getActive(accountId, input.pdno);
      if (activeResult.isErr()) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `활성 전략 없음: ${input.pdno}`,
        });
      }
      const profile = activeResult.value;

      if (!profile) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '프로필 로드 실패',
        });
      }

      // respiitPlan이 있는지 확인
      if (!profile.respiitPlan) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '리스플릿 계획이 없습니다',
        });
      }

      // 자동매매 OFF 강제 (respiit 패턴)
      if (profile.autoTradingEnabled) {
        profile.autoTradingEnabled = false;
      }

      // applyPriceRatio 적용
      try {
        const modifiedPlan = applyPriceRatio(profile.respiitPlan, {
          stages: input.stages,
          ratioPct: input.ratioPct,
        });

        // 수정된 plan을 profile에 반영
        profile.respiitPlan = modifiedPlan;

        // audit log 기록 (before/after)
        const auditPayload = {
          action: 'applyPriceRatio',
          pdno: input.pdno,
          stages: input.stages,
          ratioPct: input.ratioPct,
          timestamp: new Date().toISOString(),
        };

        // 전략 저장
        const saveResult = ctx.strategyRepo.setActive(accountId, input.pdno, profile);
        if (saveResult.isErr()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `전략 저장 실패: ${saveResult.error.kind}`,
          });
        }

        return {
          ok: true as const,
          plan: modifiedPlan,
          auditPayload,
        };
      } catch (err) {
        if (err instanceof Error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `% 일괄 증감 실패: ${err.message}`,
          });
        }
        throw err;
      }
    }),
});
