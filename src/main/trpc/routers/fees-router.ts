import { z } from 'zod';
import type { FeeEnv } from '../../db/settings-repo';
import { FEES_DEFAULTS, readFeesConfig, SETTING_KEYS } from '../../db/settings-repo';
import { publicProcedure, router } from '../trpc-core';

const FeeEnvSchema = z.enum(['real', 'mock']);
const FeesSchema = z.object({
  buy: z.number().nonnegative().finite(),
  sell: z.number().nonnegative().finite(),
  tax: z.number().nonnegative().finite(),
});

/**
 * 수수료 설정 라우터
 */
export const feesRouter = router({
  /**
   * 수수료 설정 조회
   * @param env 'real' | 'mock'
   * @returns { buy, sell, tax }
   */
  getSettings: publicProcedure.input(z.object({ env: FeeEnvSchema })).query(({ ctx, input }) => {
    return readFeesConfig(ctx.settingsRepo, input.env);
  }),

  /**
   * 모든 환경의 수수료 설정 조회
   * @returns { real: { buy, sell, tax }, mock: { buy, sell, tax } }
   */
  getAllSettings: publicProcedure.query(({ ctx }) => {
    return {
      real: readFeesConfig(ctx.settingsRepo, 'real'),
      mock: readFeesConfig(ctx.settingsRepo, 'mock'),
    };
  }),

  /**
   * 특정 환경의 수수료 설정 업데이트
   * @param env 'real' | 'mock'
   * @param buy 매입 수수료 (%)
   * @param sell 매도 수수료 (%)
   * @param tax 제세금 (%)
   */
  updateSettings: publicProcedure
    .input(
      z.object({
        env: FeeEnvSchema,
        buy: z.number().nonnegative().finite(),
        sell: z.number().nonnegative().finite(),
        tax: z.number().nonnegative().finite(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const buyKey = input.env === 'real' ? SETTING_KEYS.FEES_REAL_BUY : SETTING_KEYS.FEES_MOCK_BUY;
      const sellKey =
        input.env === 'real' ? SETTING_KEYS.FEES_REAL_SELL : SETTING_KEYS.FEES_MOCK_SELL;
      const taxKey = input.env === 'real' ? SETTING_KEYS.FEES_REAL_TAX : SETTING_KEYS.FEES_MOCK_TAX;

      ctx.settingsRepo.set(buyKey, String(input.buy));
      ctx.settingsRepo.set(sellKey, String(input.sell));
      ctx.settingsRepo.set(taxKey, String(input.tax));

      return readFeesConfig(ctx.settingsRepo, input.env);
    }),

  /**
   * 수수료 설정을 기본값으로 초기화
   * @param env 'real' | 'mock'
   */
  resetToDefaults: publicProcedure
    .input(z.object({ env: FeeEnvSchema }))
    .mutation(({ ctx, input }) => {
      const defaults = FEES_DEFAULTS[input.env];
      const buyKey = input.env === 'real' ? SETTING_KEYS.FEES_REAL_BUY : SETTING_KEYS.FEES_MOCK_BUY;
      const sellKey =
        input.env === 'real' ? SETTING_KEYS.FEES_REAL_SELL : SETTING_KEYS.FEES_MOCK_SELL;
      const taxKey = input.env === 'real' ? SETTING_KEYS.FEES_REAL_TAX : SETTING_KEYS.FEES_MOCK_TAX;

      ctx.settingsRepo.set(buyKey, String(defaults.buy));
      ctx.settingsRepo.set(sellKey, String(defaults.sell));
      ctx.settingsRepo.set(taxKey, String(defaults.tax));

      return readFeesConfig(ctx.settingsRepo, input.env);
    }),
});
