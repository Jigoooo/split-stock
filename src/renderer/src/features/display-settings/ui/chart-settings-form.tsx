import type { ReactElement } from 'react';
import type { ChartSettingsFormProps } from '../model/chart-settings-form-types';
import { ChartSettingsActions } from './chart-settings-actions';
import { CrosshairSettingsSection } from './crosshair-settings-section';
import { MaSettingsSection } from './ma-settings-section';
import { VolumeSettingsSection } from './volume-settings-section';

export const ChartSettingsForm = ({
  resolvedMa,
  resolvedVolume,
  resolvedCrosshair,
  isSaving,
  onMaChange,
  onVolumeChange,
  onCrosshairChange,
  onSave,
  onReset,
}: ChartSettingsFormProps): ReactElement => (
  <section aria-label="차트 설정" style={{ display: 'grid', gap: '1.2rem' }}>
    <MaSettingsSection isSaving={isSaving} onMaChange={onMaChange} resolvedMa={resolvedMa} />
    <VolumeSettingsSection
      isSaving={isSaving}
      onVolumeChange={onVolumeChange}
      resolvedVolume={resolvedVolume}
    />
    <CrosshairSettingsSection
      isSaving={isSaving}
      onCrosshairChange={onCrosshairChange}
      resolvedCrosshair={resolvedCrosshair}
    />
    <ChartSettingsActions isSaving={isSaving} onReset={onReset} onSave={onSave} />
  </section>
);
