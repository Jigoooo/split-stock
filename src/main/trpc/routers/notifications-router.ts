import { z } from 'zod';
import { publicProcedure, router } from '../trpc-core';

export interface NotificationSettings {
  osEnabled: boolean;
}

/**
 * 알림 설정 라우터 — Sonner toast + Electron OS 알림 제어.
 *
 * Settings:
 * - notifications.osEnabled: OS 알림 활성화 여부 (true/false)
 */
export const notificationsRouter = router({
  getSettings: publicProcedure.output(z.object({ osEnabled: z.boolean() })).query(({ ctx }) => {
    const osEnabledStr = ctx.settingsRepo.get('notifications.osEnabled');
    const osEnabled = osEnabledStr !== 'false'; // 기본값: true
    return { osEnabled };
  }),

  updateSettings: publicProcedure
    .input(z.object({ osEnabled: z.boolean() }))
    .output(z.object({ osEnabled: z.boolean() }))
    .mutation(({ ctx, input }) => {
      ctx.settingsRepo.set('notifications.osEnabled', input.osEnabled ? 'true' : 'false');
      return { osEnabled: input.osEnabled };
    }),
});
