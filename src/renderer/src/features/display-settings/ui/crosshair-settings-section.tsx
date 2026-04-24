import type { CrosshairModeType } from '@renderer/entities/display-settings';
import { Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { CrosshairChangeHandler } from '../model/chart-settings-form-types';

interface CrosshairSettingsSectionProps {
  isSaving: boolean;
  onCrosshairChange: CrosshairChangeHandler;
  resolvedCrosshair: { mode: CrosshairModeType; labelVisible: boolean };
}

export const CrosshairSettingsSection = ({
  isSaving,
  onCrosshairChange,
  resolvedCrosshair,
}: CrosshairSettingsSectionProps): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}>
      크로스헤어
    </div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, auto)',
        gap: '0.8rem 1.6rem',
        alignItems: 'center',
      }}
    >
      <label htmlFor="crosshair-mode" style={{ fontSize: '1.1rem' }}>
        모드
      </label>
      <Select
        id="crosshair-mode"
        dense
        value={resolvedCrosshair.mode}
        disabled={isSaving}
        onChange={(event) => onCrosshairChange('mode', event.target.value as CrosshairModeType)}
        style={{ minWidth: '9rem' }}
      >
        <option value="Magnet">Magnet</option>
        <option value="Normal">Normal</option>
      </Select>
      <span className="muted" style={{ fontSize: '1rem' }}>
        마그넷은 가까운 OHLC 값에 흡착합니다.
      </span>
      <label htmlFor="crosshair-label-visible" style={{ fontSize: '1.1rem' }}>
        축 라벨 표시
      </label>
      <input
        id="crosshair-label-visible"
        type="checkbox"
        checked={resolvedCrosshair.labelVisible}
        disabled={isSaving}
        onChange={(event) => onCrosshairChange('labelVisible', event.target.checked)}
        aria-label="크로스헤어 축 라벨 표시"
      />
      <span className="muted" style={{ fontSize: '1rem' }}>
        가격 축과 시간 축의 현재 위치 라벨을 함께 표시합니다.
      </span>
    </div>
  </div>
);
