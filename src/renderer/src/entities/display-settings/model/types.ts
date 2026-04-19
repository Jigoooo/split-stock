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

export interface DisplaySettings {
  chart: {
    ma: {
      5: MaSettings;
      10: MaSettings;
      20: MaSettings;
      60: MaSettings;
      120: MaSettings;
    };
    volume: VolumeSettings;
  };
  grid: {
    rowHeightPx: number;
  };
}

export type MaPeriod = 5 | 10 | 20 | 60 | 120;
export const MA_PERIODS: MaPeriod[] = [5, 10, 20, 60, 120];
