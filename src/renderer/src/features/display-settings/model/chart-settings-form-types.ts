import type { CrosshairModeType, MaPeriod, MaSettings } from '@renderer/entities/display-settings';

export type MaChangeHandler = <K extends keyof MaSettings>(
  period: MaPeriod,
  field: K,
  value: MaSettings[K],
) => void;

export type VolumeChangeHandler = <K extends 'upColor' | 'downColor' | 'heightPercent'>(
  field: K,
  value: K extends 'heightPercent' ? number : string,
) => void;

export type CrosshairChangeHandler = <K extends 'mode' | 'labelVisible'>(
  field: K,
  value: K extends 'labelVisible' ? boolean : CrosshairModeType,
) => void;

export interface ChartSettingsFormProps {
  resolvedMa: (period: MaPeriod) => MaSettings;
  resolvedVolume: { upColor: string; downColor: string; heightPercent: number };
  resolvedCrosshair: { mode: CrosshairModeType; labelVisible: boolean };
  isSaving: boolean;
  onMaChange: MaChangeHandler;
  onVolumeChange: VolumeChangeHandler;
  onCrosshairChange: CrosshairChangeHandler;
  onSave: () => void;
  onReset: () => void;
}
