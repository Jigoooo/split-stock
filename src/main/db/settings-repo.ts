import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { settings } from './schema';

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const rows = this.db.select().from(settings).where(eq(settings.key, key)).all();
    return rows[0]?.value ?? null;
  }

  set(key: string, value: string): void {
    const existing = this.db.select().from(settings).where(eq(settings.key, key)).all();
    const now = new Date();
    if (existing.length > 0) {
      this.db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key)).run();
    } else {
      this.db.insert(settings).values({ key, value, updatedAt: now }).run();
    }
  }

  delete(key: string): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }

  list(): Array<{ key: string; value: string }> {
    return this.db.select({ key: settings.key, value: settings.value }).from(settings).all();
  }
}

export type ReorderMode = 'NONE' | 'MARKET' | 'LIMIT_AT_LAST_PRICE';

export const SETTING_KEYS = {
  LAST_ACTIVE_ENV: 'last_active_env',
  WATCH_GLOBAL_ENABLED_PREFIX: 'watch.global.enabled',
  /** 미체결 자동 취소 활성화 여부 ('true'/'false'). */
  PENDING_CANCEL_ENABLED: 'pending_cancel_enabled',
  /** 미체결 지정가 주문 자동 취소 타임아웃 (분, 1~60). */
  PENDING_CANCEL_TIMEOUT_MIN: 'pending_cancel_timeout_min',
  /** 자동 취소 재시도 최대 횟수 (1~30) 또는 'unlimited'. */
  PENDING_CANCEL_MAX_RETRIES: 'pending_cancel_max_retries',
  /** 취소 후 재주문 모드: 'NONE'|'MARKET'|'LIMIT_AT_LAST_PRICE'. */
  PENDING_CANCEL_REORDER_MODE: 'pending_cancel_reorder_mode',
  /** 실 계좌 매입 수수료 (%) */
  FEES_REAL_BUY: 'fees.real.buy',
  /** 실 계좌 매도 수수료 (%) */
  FEES_REAL_SELL: 'fees.real.sell',
  /** 실 계좌 제세금 (%) */
  FEES_REAL_TAX: 'fees.real.tax',
  /** 모의 계좌 매입 수수료 (%) */
  FEES_MOCK_BUY: 'fees.mock.buy',
  /** 모의 계좌 매도 수수료 (%) */
  FEES_MOCK_SELL: 'fees.mock.sell',
  /** 모의 계좌 제세금 (%) */
  FEES_MOCK_TAX: 'fees.mock.tax',
  /** 지정가 매수 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_BUY: 'price_correction.buy',
  /** 지정가 매도 호가 자동 보정 전략: 'AGGRESSIVE'|'CONSERVATIVE'. */
  PRICE_CORRECTION_SELL: 'price_correction.sell',

  // ── 표시 설정: 이동평균선 ──────────────────────────────────────────
  DISPLAY_MA5_ENABLED: 'display.chart.ma5.enabled',
  DISPLAY_MA5_COLOR: 'display.chart.ma5.color',
  DISPLAY_MA5_WIDTH: 'display.chart.ma5.width',
  DISPLAY_MA5_STYLE: 'display.chart.ma5.style',

  DISPLAY_MA10_ENABLED: 'display.chart.ma10.enabled',
  DISPLAY_MA10_COLOR: 'display.chart.ma10.color',
  DISPLAY_MA10_WIDTH: 'display.chart.ma10.width',
  DISPLAY_MA10_STYLE: 'display.chart.ma10.style',

  DISPLAY_MA20_ENABLED: 'display.chart.ma20.enabled',
  DISPLAY_MA20_COLOR: 'display.chart.ma20.color',
  DISPLAY_MA20_WIDTH: 'display.chart.ma20.width',
  DISPLAY_MA20_STYLE: 'display.chart.ma20.style',

  DISPLAY_MA60_ENABLED: 'display.chart.ma60.enabled',
  DISPLAY_MA60_COLOR: 'display.chart.ma60.color',
  DISPLAY_MA60_WIDTH: 'display.chart.ma60.width',
  DISPLAY_MA60_STYLE: 'display.chart.ma60.style',

  DISPLAY_MA120_ENABLED: 'display.chart.ma120.enabled',
  DISPLAY_MA120_COLOR: 'display.chart.ma120.color',
  DISPLAY_MA120_WIDTH: 'display.chart.ma120.width',
  DISPLAY_MA120_STYLE: 'display.chart.ma120.style',

  // ── 표시 설정: 거래량 ─────────────────────────────────────────────
  DISPLAY_VOLUME_UP_COLOR: 'display.chart.volume.upColor',
  DISPLAY_VOLUME_DOWN_COLOR: 'display.chart.volume.downColor',
  DISPLAY_VOLUME_HEIGHT_PERCENT: 'display.chart.volume.heightPercent',
  DISPLAY_CROSSHAIR_MODE: 'display.chart.crosshair.mode',
  DISPLAY_CROSSHAIR_LABEL_VISIBLE: 'display.chart.crosshair.labelVisible',

  // ── 표시 설정: 그리드 ─────────────────────────────────────────────
  DISPLAY_GRID_ROW_HEIGHT_PX: 'display.grid.rowHeightPx',
  DISPLAY_GRID_STAGE_CELL_MODE: 'display.grid.stageCellMode',

  // ── 실시간 설정 ─────────────────────────────────────────────────
  /** WS 세션 capacity — KIS 기본 20, 향후 60 확장 시 사용자가 변경 가능 (1~60). */
  REALTIME_WS_CAPACITY: 'realtime.wsCapacity',

  // ── 백업 설정 ───────────────────────────────────────────────────
  /** 2중 백업 외부 드라이브 경로 */
  BACKUP_DUPLICATE_PATH: 'backup.duplicatePath',
  /** 자동 백업 활성화 (기본: true) */
  BACKUP_AUTO_ENABLED: 'backup.autoEnabled',
  /** 자동 백업 보관 일수 (기본: 10일, 1~365 범위) */
  BACKUP_AUTO_RETENTION_DAYS: 'backup.autoRetentionDays',
} as const;

export function watchGlobalEnabledKey(accountId: number): string {
  return `${SETTING_KEYS.WATCH_GLOBAL_ENABLED_PREFIX}.${accountId}`;
}

export const PENDING_CANCEL_DEFAULTS = {
  enabled: true,
  timeoutMin: 10,
  maxRetries: 5 as number | null,
  reorderMode: 'NONE' as ReorderMode,
} as const;

export type FeeEnv = 'real' | 'mock';

export const FEES_DEFAULTS = {
  real: { buy: 0.015, sell: 0.015, tax: 0.2 },
  mock: { buy: 0.35, sell: 0.35, tax: 0.2 },
} as const;

export const BACKUP_AUTO_DEFAULTS = {
  enabled: true,
  retentionDays: 10,
} as const;

export function readBackupAutoConfig(repo: SettingsRepo): {
  enabled: boolean;
  retentionDays: number;
} {
  const enabledRaw = repo.get(SETTING_KEYS.BACKUP_AUTO_ENABLED);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : BACKUP_AUTO_DEFAULTS.enabled;

  const daysRaw = repo.get(SETTING_KEYS.BACKUP_AUTO_RETENTION_DAYS);
  const days = daysRaw !== null ? Number(daysRaw) : BACKUP_AUTO_DEFAULTS.retentionDays;
  const retentionDays =
    Number.isFinite(days) && days >= 1 && days <= 365
      ? Math.floor(days)
      : BACKUP_AUTO_DEFAULTS.retentionDays;

  return { enabled, retentionDays };
}

export function readFeesConfig(
  repo: SettingsRepo,
  env: FeeEnv,
): {
  buy: number;
  sell: number;
  tax: number;
} {
  const buyKey = env === 'real' ? SETTING_KEYS.FEES_REAL_BUY : SETTING_KEYS.FEES_MOCK_BUY;
  const sellKey = env === 'real' ? SETTING_KEYS.FEES_REAL_SELL : SETTING_KEYS.FEES_MOCK_SELL;
  const taxKey = env === 'real' ? SETTING_KEYS.FEES_REAL_TAX : SETTING_KEYS.FEES_MOCK_TAX;

  const defaults = FEES_DEFAULTS[env];

  const buyRaw = repo.get(buyKey);
  const buy = buyRaw !== null ? Number(buyRaw) : defaults.buy;

  const sellRaw = repo.get(sellKey);
  const sell = sellRaw !== null ? Number(sellRaw) : defaults.sell;

  const taxRaw = repo.get(taxKey);
  const tax = taxRaw !== null ? Number(taxRaw) : defaults.tax;

  return { buy, sell, tax };
}

export function readPendingCancelConfig(repo: SettingsRepo): {
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number | null;
  reorderMode: ReorderMode;
} {
  const enabledRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_ENABLED);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : PENDING_CANCEL_DEFAULTS.enabled;

  const minRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN);
  const minutes = minRaw !== null ? Number(minRaw) : PENDING_CANCEL_DEFAULTS.timeoutMin;
  const clampedMin =
    Number.isFinite(minutes) && minutes >= 1 && minutes <= 60
      ? minutes
      : PENDING_CANCEL_DEFAULTS.timeoutMin;

  const retriesRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES);
  let maxRetries: number | null;
  if (retriesRaw === null) {
    maxRetries = PENDING_CANCEL_DEFAULTS.maxRetries;
  } else if (retriesRaw === 'unlimited') {
    maxRetries = null;
  } else {
    const n = Number(retriesRaw);
    maxRetries = Number.isFinite(n) && n >= 1 && n <= 30 ? n : PENDING_CANCEL_DEFAULTS.maxRetries;
  }

  const reorderRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_REORDER_MODE);
  const validReorderModes: ReorderMode[] = ['NONE', 'MARKET', 'LIMIT_AT_LAST_PRICE'];
  const reorderMode: ReorderMode =
    reorderRaw !== null && validReorderModes.includes(reorderRaw as ReorderMode)
      ? (reorderRaw as ReorderMode)
      : PENDING_CANCEL_DEFAULTS.reorderMode;

  return { enabled, timeoutMs: clampedMin * 60_000, maxRetries, reorderMode };
}

export function readWatchGlobalEnabled(repo: SettingsRepo, accountId: number): boolean {
  const raw = repo.get(watchGlobalEnabledKey(accountId));
  return raw !== 'false';
}

export type PriceCorrectionStrategy = 'AGGRESSIVE' | 'CONSERVATIVE';

export const PRICE_CORRECTION_DEFAULTS = {
  buy: 'AGGRESSIVE' as PriceCorrectionStrategy,
  sell: 'AGGRESSIVE' as PriceCorrectionStrategy,
} as const;

export function readPriceCorrectionConfig(repo: SettingsRepo): {
  buy: PriceCorrectionStrategy;
  sell: PriceCorrectionStrategy;
} {
  const validStrategies: PriceCorrectionStrategy[] = ['AGGRESSIVE', 'CONSERVATIVE'];

  const buyRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_BUY);
  const buy: PriceCorrectionStrategy =
    buyRaw !== null && validStrategies.includes(buyRaw as PriceCorrectionStrategy)
      ? (buyRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.buy;

  const sellRaw = repo.get(SETTING_KEYS.PRICE_CORRECTION_SELL);
  const sell: PriceCorrectionStrategy =
    sellRaw !== null && validStrategies.includes(sellRaw as PriceCorrectionStrategy)
      ? (sellRaw as PriceCorrectionStrategy)
      : PRICE_CORRECTION_DEFAULTS.sell;

  return { buy, sell };
}

// ═══════════════════════════════════════════════════════════════════
// Display Settings
// ═══════════════════════════════════════════════════════════════════

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

export interface MaSettings {
  enabled: boolean;
  color: string;
  width: number;
  style: LineStyleType;
}

export interface VolumeSettings {
  upColor: string;
  downColor: string;
  heightPercent: number;
}

export type CrosshairModeType = 'Magnet' | 'Normal';

export interface CrosshairSettings {
  mode: CrosshairModeType;
  labelVisible: boolean;
}

export interface DisplaySettings {
  chart: {
    ma: Record<5 | 10 | 20 | 60 | 120, MaSettings>;
    volume: VolumeSettings;
    crosshair: CrosshairSettings;
  };
  grid: {
    rowHeightPx: number;
    stageCellMode: BalanceStageCellMode;
  };
}

export type BalanceStageCellMode = 'PERCENT' | 'DATE' | 'QTY';

const MA_DEFAULTS: Record<5 | 10 | 20 | 60 | 120, MaSettings> = {
  5: { enabled: true, color: '#e83d3d', width: 1, style: 'solid' },
  10: { enabled: true, color: '#e8973d', width: 1, style: 'solid' },
  20: { enabled: true, color: '#3d82e8', width: 1, style: 'solid' },
  60: { enabled: false, color: '#8b3de8', width: 1, style: 'solid' },
  120: { enabled: false, color: '#3de89a', width: 1, style: 'solid' },
};

const VOLUME_DEFAULTS: VolumeSettings = {
  upColor: 'rgba(220,38,38,0.5)',
  downColor: 'rgba(37,99,235,0.5)',
  heightPercent: 30,
};

const CROSSHAIR_DEFAULTS: CrosshairSettings = {
  mode: 'Magnet',
  labelVisible: true,
};

const DISPLAY_GRID_DEFAULTS = { rowHeightPx: 26, stageCellMode: 'PERCENT' as BalanceStageCellMode };

function readMa(repo: SettingsRepo, period: 5 | 10 | 20 | 60 | 120): MaSettings {
  const p = period as 5 | 10 | 20 | 60 | 120;
  const keys = {
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
  } as const;
  const k = keys[p];
  const def = MA_DEFAULTS[p];

  const enabledRaw = repo.get(k.enabled);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : def.enabled;

  const colorRaw = repo.get(k.color);
  const color = colorRaw ?? def.color;

  const widthRaw = repo.get(k.width);
  const widthNum = widthRaw !== null ? Number(widthRaw) : def.width;
  const width = Number.isFinite(widthNum) && widthNum >= 1 && widthNum <= 5 ? widthNum : def.width;

  const styleRaw = repo.get(k.style);
  const validStyles: LineStyleType[] = ['solid', 'dashed', 'dotted'];
  const style: LineStyleType =
    styleRaw !== null && validStyles.includes(styleRaw as LineStyleType)
      ? (styleRaw as LineStyleType)
      : def.style;

  return { enabled, color, width, style };
}

export function readDisplayConfig(repo: SettingsRepo): DisplaySettings {
  const upColorRaw = repo.get(SETTING_KEYS.DISPLAY_VOLUME_UP_COLOR);
  const downColorRaw = repo.get(SETTING_KEYS.DISPLAY_VOLUME_DOWN_COLOR);
  const heightRaw = repo.get(SETTING_KEYS.DISPLAY_VOLUME_HEIGHT_PERCENT);
  const heightNum = heightRaw !== null ? Number(heightRaw) : VOLUME_DEFAULTS.heightPercent;
  const heightPercent =
    Number.isFinite(heightNum) && heightNum >= 10 && heightNum <= 60
      ? heightNum
      : VOLUME_DEFAULTS.heightPercent;

  const rowHRaw = repo.get(SETTING_KEYS.DISPLAY_GRID_ROW_HEIGHT_PX);
  const rowNum = rowHRaw !== null ? Number(rowHRaw) : DISPLAY_GRID_DEFAULTS.rowHeightPx;
  const rowHeightPx =
    Number.isFinite(rowNum) && rowNum >= 18 && rowNum <= 60
      ? rowNum
      : DISPLAY_GRID_DEFAULTS.rowHeightPx;
  const stageCellModeRaw = repo.get(SETTING_KEYS.DISPLAY_GRID_STAGE_CELL_MODE);
  const validStageCellModes: BalanceStageCellMode[] = ['PERCENT', 'DATE', 'QTY'];
  const stageCellMode: BalanceStageCellMode =
    stageCellModeRaw !== null &&
    validStageCellModes.includes(stageCellModeRaw as BalanceStageCellMode)
      ? (stageCellModeRaw as BalanceStageCellMode)
      : DISPLAY_GRID_DEFAULTS.stageCellMode;

  const crosshairModeRaw = repo.get(SETTING_KEYS.DISPLAY_CROSSHAIR_MODE);
  const validCrosshairModes: CrosshairModeType[] = ['Magnet', 'Normal'];
  const crosshairMode: CrosshairModeType =
    crosshairModeRaw !== null && validCrosshairModes.includes(crosshairModeRaw as CrosshairModeType)
      ? (crosshairModeRaw as CrosshairModeType)
      : CROSSHAIR_DEFAULTS.mode;

  const crosshairLabelRaw = repo.get(SETTING_KEYS.DISPLAY_CROSSHAIR_LABEL_VISIBLE);
  const crosshairLabelVisible =
    crosshairLabelRaw !== null ? crosshairLabelRaw === 'true' : CROSSHAIR_DEFAULTS.labelVisible;

  return {
    chart: {
      ma: {
        5: readMa(repo, 5),
        10: readMa(repo, 10),
        20: readMa(repo, 20),
        60: readMa(repo, 60),
        120: readMa(repo, 120),
      },
      volume: {
        upColor: upColorRaw ?? VOLUME_DEFAULTS.upColor,
        downColor: downColorRaw ?? VOLUME_DEFAULTS.downColor,
        heightPercent,
      },
      crosshair: {
        mode: crosshairMode,
        labelVisible: crosshairLabelVisible,
      },
    },
    grid: { rowHeightPx, stageCellMode },
  };
}

export const DISPLAY_DEFAULTS = {
  ma: MA_DEFAULTS,
  volume: VOLUME_DEFAULTS,
  crosshair: CROSSHAIR_DEFAULTS,
  grid: DISPLAY_GRID_DEFAULTS,
} as const;

// ═══════════════════════════════════════════════════════════════════
// Realtime Settings
// ═══════════════════════════════════════════════════════════════════

export const REALTIME_DEFAULTS = {
  /** KIS WS 세션 capacity 기본값 — 현행 한도(20). 60 확장 시 UI에서 변경 가능. */
  wsCapacity: 20,
  /** 사용자가 설정 가능한 capacity 범위 — 60종목 확장 시 상한 60. */
  wsCapacityMin: 1,
  wsCapacityMax: 60,
} as const;

export interface RealtimeConfig {
  wsCapacity: number;
}

export function readRealtimeConfig(repo: SettingsRepo): RealtimeConfig {
  const raw = repo.get(SETTING_KEYS.REALTIME_WS_CAPACITY);
  const n = raw !== null ? Number(raw) : REALTIME_DEFAULTS.wsCapacity;
  const wsCapacity =
    Number.isFinite(n) &&
    n >= REALTIME_DEFAULTS.wsCapacityMin &&
    n <= REALTIME_DEFAULTS.wsCapacityMax
      ? Math.floor(n)
      : REALTIME_DEFAULTS.wsCapacity;
  return { wsCapacity };
}
