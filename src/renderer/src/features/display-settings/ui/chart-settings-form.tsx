import type { ReactElement } from 'react';
import type { ChartSettingsFormProps } from '../model/chart-settings-form-types';
import { ChartSettingsActions } from './chart-settings-actions';
import { MaSettingsSection } from './ma-settings-section';
import { VolumeSettingsSection } from './volume-settings-section';

// 크로스헤어 섹션은 UI 에서 제거 — backend default(Magnet + labelVisible) 그대로 유지.
// 사용자 가치 대비 복잡도가 낮아 폼 제거. resolvedCrosshair / onCrosshairChange 는
// 호환성을 위해 props 시그니처는 유지하되 렌더하지 않는다.
export const ChartSettingsForm = ({
  resolvedMa,
  resolvedVolume,
  isDirty,
  isSaving,
  onMaChange,
  onVolumeChange,
  onSave,
  onReset,
}: ChartSettingsFormProps): ReactElement => (
  <section aria-label="차트 설정" style={{ display: 'grid', gap: '1.8rem' }}>
    <MaSettingsSection isSaving={isSaving} onMaChange={onMaChange} resolvedMa={resolvedMa} />
    <VolumeSettingsSection
      isSaving={isSaving}
      onVolumeChange={onVolumeChange}
      resolvedVolume={resolvedVolume}
    />
    <ChartSettingsActions isDirty={isDirty} isSaving={isSaving} onReset={onReset} onSave={onSave} />
  </section>
);
