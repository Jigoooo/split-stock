import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

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
