import { z } from 'zod';
import { DISPLAY_DEFAULTS, readDisplayConfig, SETTING_KEYS } from '../../db/settings-repo';
import { publicProcedure, router } from '../trpc-core';

const LineStyleSchema = z.enum(['solid', 'dashed', 'dotted']);

const MaSettingsSchema = z.object({
  enabled: z.boolean(),
  color: z.string().min(1),
  width: z.number().int().min(1).max(5),
  style: LineStyleSchema,
});

const UpdateDisplaySettingsSchema = z.object({
  chart: z
    .object({
      ma: z
        .object({
          5: MaSettingsSchema.optional(),
          10: MaSettingsSchema.optional(),
          20: MaSettingsSchema.optional(),
          60: MaSettingsSchema.optional(),
          120: MaSettingsSchema.optional(),
        })
        .optional(),
      volume: z
        .object({
          upColor: z.string().min(1).optional(),
          downColor: z.string().min(1).optional(),
          heightPercent: z.number().min(10).max(60).optional(),
        })
        .optional(),
      crosshair: z
        .object({
          mode: z.enum(['Magnet', 'Normal']).optional(),
          labelVisible: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  grid: z
    .object({
      rowHeightPx: z.number().int().min(18).max(60).optional(),
    })
    .optional(),
});

const MA_PERIODS = [5, 10, 20, 60, 120] as const;
type MaPeriod = (typeof MA_PERIODS)[number];

const MA_KEY_MAP: Record<
  MaPeriod,
  {
    enabled: string;
    color: string;
    width: string;
    style: string;
  }
> = {
  5: {
    enabled: SETTING_KEYS.DISPLAY_MA5_ENABLED,
    color: SETTING_KEYS.DISPLAY_MA5_COLOR,
    width: SETTING_KEYS.DISPLAY_MA5_WIDTH,
    style: SETTING_KEYS.DISPLAY_MA5_STYLE,
  },
  10: {
    enabled: SETTING_KEYS.DISPLAY_MA10_ENABLED,
    color: SETTING_KEYS.DISPLAY_MA10_COLOR,
    width: SETTING_KEYS.DISPLAY_MA10_WIDTH,
    style: SETTING_KEYS.DISPLAY_MA10_STYLE,
  },
  20: {
    enabled: SETTING_KEYS.DISPLAY_MA20_ENABLED,
    color: SETTING_KEYS.DISPLAY_MA20_COLOR,
    width: SETTING_KEYS.DISPLAY_MA20_WIDTH,
    style: SETTING_KEYS.DISPLAY_MA20_STYLE,
  },
  60: {
    enabled: SETTING_KEYS.DISPLAY_MA60_ENABLED,
    color: SETTING_KEYS.DISPLAY_MA60_COLOR,
    width: SETTING_KEYS.DISPLAY_MA60_WIDTH,
    style: SETTING_KEYS.DISPLAY_MA60_STYLE,
  },
  120: {
    enabled: SETTING_KEYS.DISPLAY_MA120_ENABLED,
    color: SETTING_KEYS.DISPLAY_MA120_COLOR,
    width: SETTING_KEYS.DISPLAY_MA120_WIDTH,
    style: SETTING_KEYS.DISPLAY_MA120_STYLE,
  },
};

export const displayRouter = router({
  /**
   * 표시 설정 전체 조회.
   * 저장 값 없으면 기본값 반환.
   */
  getSettings: publicProcedure.query(({ ctx }) => {
    return readDisplayConfig(ctx.settingsRepo);
  }),

  /**
   * 표시 설정 부분 업데이트 (지정 필드만 저장).
   */
  updateSettings: publicProcedure.input(UpdateDisplaySettingsSchema).mutation(({ ctx, input }) => {
    const repo = ctx.settingsRepo;

    if (input.chart?.ma) {
      for (const period of MA_PERIODS) {
        const maInput = input.chart.ma[period];
        if (!maInput) continue;
        const k = MA_KEY_MAP[period];
        repo.set(k.enabled, String(maInput.enabled));
        repo.set(k.color, maInput.color);
        repo.set(k.width, String(maInput.width));
        repo.set(k.style, maInput.style);
      }
    }

    if (input.chart?.volume) {
      const vol = input.chart.volume;
      if (vol.upColor !== undefined) {
        repo.set(SETTING_KEYS.DISPLAY_VOLUME_UP_COLOR, vol.upColor);
      }
      if (vol.downColor !== undefined) {
        repo.set(SETTING_KEYS.DISPLAY_VOLUME_DOWN_COLOR, vol.downColor);
      }
      if (vol.heightPercent !== undefined) {
        repo.set(SETTING_KEYS.DISPLAY_VOLUME_HEIGHT_PERCENT, String(vol.heightPercent));
      }
    }

    if (input.chart?.crosshair) {
      const crosshair = input.chart.crosshair;
      if (crosshair.mode !== undefined) {
        repo.set(SETTING_KEYS.DISPLAY_CROSSHAIR_MODE, crosshair.mode);
      }
      if (crosshair.labelVisible !== undefined) {
        repo.set(SETTING_KEYS.DISPLAY_CROSSHAIR_LABEL_VISIBLE, String(crosshair.labelVisible));
      }
    }

    if (input.grid?.rowHeightPx !== undefined) {
      repo.set(SETTING_KEYS.DISPLAY_GRID_ROW_HEIGHT_PX, String(input.grid.rowHeightPx));
    }

    return { ok: true as const };
  }),

  /**
   * 표시 설정 전체 초기화.
   */
  resetSettings: publicProcedure.mutation(({ ctx }) => {
    const repo = ctx.settingsRepo;

    for (const period of MA_PERIODS) {
      const k = MA_KEY_MAP[period];
      const def = DISPLAY_DEFAULTS.ma[period];
      repo.set(k.enabled, String(def.enabled));
      repo.set(k.color, def.color);
      repo.set(k.width, String(def.width));
      repo.set(k.style, def.style);
    }

    repo.set(SETTING_KEYS.DISPLAY_VOLUME_UP_COLOR, DISPLAY_DEFAULTS.volume.upColor);
    repo.set(SETTING_KEYS.DISPLAY_VOLUME_DOWN_COLOR, DISPLAY_DEFAULTS.volume.downColor);
    repo.set(
      SETTING_KEYS.DISPLAY_VOLUME_HEIGHT_PERCENT,
      String(DISPLAY_DEFAULTS.volume.heightPercent),
    );
    repo.set(SETTING_KEYS.DISPLAY_CROSSHAIR_MODE, DISPLAY_DEFAULTS.crosshair.mode);
    repo.set(
      SETTING_KEYS.DISPLAY_CROSSHAIR_LABEL_VISIBLE,
      String(DISPLAY_DEFAULTS.crosshair.labelVisible),
    );
    repo.set(SETTING_KEYS.DISPLAY_GRID_ROW_HEIGHT_PX, String(DISPLAY_DEFAULTS.grid.rowHeightPx));

    return { ok: true as const };
  }),
});
