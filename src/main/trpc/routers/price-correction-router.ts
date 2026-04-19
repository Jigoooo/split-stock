import { z } from 'zod';
import {
  PRICE_CORRECTION_DEFAULTS,
  type PriceCorrectionStrategy,
  readPriceCorrectionConfig,
  SETTING_KEYS,
} from '../../db/settings-repo';
import { publicProcedure, router } from '../trpc-core';

const PriceCorrectionStrategySchema = z.enum(['AGGRESSIVE', 'CONSERVATIVE']);

export const priceCorrectionRouter = router({
  /**
   * 호가 자동 보정 설정 조회.
   * 저장 값이 없으면 기본값(AGGRESSIVE/AGGRESSIVE)을 반환.
   */
  getSettings: publicProcedure.query(({ ctx }) => {
    return readPriceCorrectionConfig(ctx.settingsRepo);
  }),

  /**
   * 호가 자동 보정 설정 저장.
   * buy / sell 각각 AGGRESSIVE 또는 CONSERVATIVE.
   */
  updateSettings: publicProcedure
    .input(
      z.object({
        buy: PriceCorrectionStrategySchema,
        sell: PriceCorrectionStrategySchema,
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.settingsRepo.set(SETTING_KEYS.PRICE_CORRECTION_BUY, input.buy);
      ctx.settingsRepo.set(SETTING_KEYS.PRICE_CORRECTION_SELL, input.sell);
      return { ok: true as const };
    }),

  /**
   * 보정 설정을 기본값으로 초기화.
   */
  resetSettings: publicProcedure.mutation(({ ctx }) => {
    ctx.settingsRepo.set(SETTING_KEYS.PRICE_CORRECTION_BUY, PRICE_CORRECTION_DEFAULTS.buy);
    ctx.settingsRepo.set(SETTING_KEYS.PRICE_CORRECTION_SELL, PRICE_CORRECTION_DEFAULTS.sell);
    return { ok: true as const };
  }),
});
