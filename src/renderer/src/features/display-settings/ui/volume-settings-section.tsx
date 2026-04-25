import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { colorInputStyle } from '../config/chart-settings-options';
import type { VolumeChangeHandler } from '../model/chart-settings-form-types';

interface VolumeSettingsSectionProps {
  isSaving: boolean;
  onVolumeChange: VolumeChangeHandler;
  resolvedVolume: { upColor: string; downColor: string; heightPercent: number };
}

export const VolumeSettingsSection = ({
  isSaving,
  onVolumeChange,
  resolvedVolume,
}: VolumeSettingsSectionProps): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}>
      거래량
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, auto)',
        gap: '0.8rem 1.6rem',
        alignItems: 'center',
      }}
    >
      <label htmlFor="vol-up-color" style={{ fontSize: '1.1rem' }}>
        상승 색상
      </label>
      <input
        id="vol-up-color"
        type="color"
        value={resolvedVolume.upColor.startsWith('rgba') ? '#dc2626' : resolvedVolume.upColor}
        disabled={isSaving}
        onChange={(event) => onVolumeChange('upColor', event.target.value)}
        style={colorInputStyle}
      />
      <span />
      <label htmlFor="vol-down-color" style={{ fontSize: '1.1rem' }}>
        하락 색상
      </label>
      <input
        id="vol-down-color"
        type="color"
        value={resolvedVolume.downColor.startsWith('rgba') ? '#2563eb' : resolvedVolume.downColor}
        disabled={isSaving}
        onChange={(event) => onVolumeChange('downColor', event.target.value)}
        style={colorInputStyle}
      />
      <span />
      <label htmlFor="vol-height" style={{ fontSize: '1.1rem' }}>
        높이 비율 (%)
      </label>
      <span style={{ width: '8.5rem', display: 'inline-flex' }}>
        <NumberInput
          id="vol-height"
          dense
          showSpinner
          min={10}
          max={60}
          step={1}
          value={String(resolvedVolume.heightPercent)}
          disabled={isSaving}
          onValueChange={(raw) => {
            const next = Number(raw);
            if (Number.isFinite(next) && next >= 10 && next <= 60) {
              onVolumeChange('heightPercent', next);
            }
          }}
          aria-label="거래량 높이 비율 (%)"
        />
      </span>
      <span className="muted" style={{ fontSize: '1rem' }}>
        10~60%
      </span>
    </div>
  </div>
);
