import {
  type LineStyleType,
  MA_PERIODS,
  type MaPeriod,
  type MaSettings,
} from '@renderer/entities/display-settings';
import { Select, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { colorInputStyle, LINE_STYLE_OPTIONS, MA_LABEL } from '../config/chart-settings-options';
import type { MaChangeHandler } from '../model/chart-settings-form-types';

interface MaSettingsSectionProps {
  isSaving: boolean;
  onMaChange: MaChangeHandler;
  resolvedMa: (period: MaPeriod) => MaSettings;
}

export const MaSettingsSection = ({
  isSaving,
  onMaChange,
  resolvedMa,
}: MaSettingsSectionProps): ReactElement => (
  <div>
    <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}>
      이동평균선
    </div>
    <TableGrid.Root
      variant="hts"
      stickyHeader={false}
      overlayScrollbar={false}
      style={{ height: 'auto' }}
    >
      <TableGrid.Header>
        <TableGrid.Cell width={56}>표시</TableGrid.Cell>
        <TableGrid.Cell width={64}>기간</TableGrid.Cell>
        <TableGrid.Cell width={96}>색상</TableGrid.Cell>
        <TableGrid.Cell width={72}>두께</TableGrid.Cell>
        <TableGrid.Cell flex={1}>스타일</TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {MA_PERIODS.map((period) => {
          const ma = resolvedMa(period);
          return (
            <TableGrid.Row key={period}>
              <TableGrid.Cell width={56}>
                <input
                  type="checkbox"
                  checked={ma.enabled}
                  disabled={isSaving}
                  onChange={(event) => onMaChange(period, 'enabled', event.target.checked)}
                  aria-label={`${MA_LABEL[period]} 표시`}
                />
              </TableGrid.Cell>
              <TableGrid.Cell width={64}>{MA_LABEL[period]}</TableGrid.Cell>
              <TableGrid.Cell width={96}>
                <input
                  type="color"
                  value={ma.color.startsWith('rgba') ? '#888888' : ma.color}
                  disabled={isSaving}
                  onChange={(event) => onMaChange(period, 'color', event.target.value)}
                  aria-label={`${MA_LABEL[period]} 색상`}
                  style={colorInputStyle}
                />
              </TableGrid.Cell>
              <TableGrid.Cell width={72}>
                <input
                  type="number"
                  className="hts-input hts-input--dense hts-input--num"
                  min={1}
                  max={5}
                  value={ma.width}
                  disabled={isSaving}
                  onChange={(event) => onMaChange(period, 'width', Number(event.target.value))}
                  aria-label={`${MA_LABEL[period]} 두께`}
                  style={{ width: '4rem' }}
                />
              </TableGrid.Cell>
              <TableGrid.Cell flex={1}>
                <Select
                  dense
                  value={ma.style}
                  disabled={isSaving}
                  onChange={(event) =>
                    onMaChange(period, 'style', event.target.value as LineStyleType)
                  }
                  aria-label={`${MA_LABEL[period]} 스타일`}
                >
                  {LINE_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </TableGrid.Cell>
            </TableGrid.Row>
          );
        })}
      </TableGrid.Body>
    </TableGrid.Root>
  </div>
);
