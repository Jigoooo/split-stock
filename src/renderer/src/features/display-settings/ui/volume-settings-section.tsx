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
    <div
      style={{
        fontSize: '1.35rem',
        fontWeight: 700,
        color: 'var(--fg)',
        marginBottom: '0.8rem',
        paddingBottom: '0.4rem',
        borderBottom: '0.1rem solid var(--border)',
      }}
    >
      거래량
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '7rem 9rem auto',
        gap: '0.6rem 0.8rem',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: '1.1rem' }}>상승 색상</span>
      <input
        id="vol-up-color"
        type="color"
        value={resolvedVolume.upColor.startsWith('rgba') ? '#dc2626' : resolvedVolume.upColor}
        disabled={isSaving}
        onChange={(event) => onVolumeChange('upColor', event.target.value)}
        aria-label="거래량 상승 색상"
        style={colorInputStyle}
      />
      <span />
      <span style={{ fontSize: '1.1rem' }}>하락 색상</span>
      <input
        id="vol-down-color"
        type="color"
        value={resolvedVolume.downColor.startsWith('rgba') ? '#2563eb' : resolvedVolume.downColor}
        disabled={isSaving}
        onChange={(event) => onVolumeChange('downColor', event.target.value)}
        aria-label="거래량 하락 색상"
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
