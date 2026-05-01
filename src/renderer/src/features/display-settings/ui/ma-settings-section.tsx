import {
  type LineStyleType,
  MA_PERIODS,
  type MaPeriod,
  type MaSettings,
} from '@renderer/entities/display-settings';
import { NumberInput, Select, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { colorInputStyle, LINE_STYLE_OPTIONS, MA_LABEL } from '../config/chart-settings-options';
import type { MaChangeHandler } from '../model/chart-settings-form-types';

/**
 * input[type=color] 는 #RRGGBB 만 지원. 저장된 색이 rgba()/rgb() 면
 * RGB 채널을 hex 로 변환해 picker 초기값으로 노출 (alpha 손실은 감수).
 * 잘못된 형식은 #888888 fallback.
 */
function colorToHex(color: string): string {
  if (color.startsWith('#')) return color;
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return '#888888';
  const toHex = (n: string): string => {
    const v = Math.max(0, Math.min(255, Number(n))).toString(16);
    return v.length === 1 ? `0${v}` : v;
  };
  return `#${toHex(m[1] ?? '0')}${toHex(m[2] ?? '0')}${toHex(m[3] ?? '0')}`;
}

interface MaSettingsSectionProps {
  isSaving: boolean;
  onMaChange: MaChangeHandler;
  resolvedMa: (period: MaPeriod) => MaSettings;
}

const CELL_FLUSH_STYLE = { padding: '0.2rem 0.4rem' };

export const MaSettingsSection = ({
  isSaving,
  onMaChange,
  resolvedMa,
}: MaSettingsSectionProps): ReactElement => (
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
      이동평균선
    </div>
    <TableGrid.Root
      variant="hts"
      stickyHeader={false}
      overlayScrollbar={false}
      style={{ height: 'auto', '--hts-row-height': '3.6rem' } as React.CSSProperties}
    >
      <TableGrid.Header>
        <TableGrid.Cell width="5.6rem">표시</TableGrid.Cell>
        <TableGrid.Cell width="6.4rem">기간</TableGrid.Cell>
        <TableGrid.Cell width="5.6rem">색상</TableGrid.Cell>
        <TableGrid.Cell width="8.8rem">두께</TableGrid.Cell>
        <TableGrid.Cell width="12rem">스타일</TableGrid.Cell>
        <TableGrid.Cell flex={1}> </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {MA_PERIODS.map((period) => {
          const ma = resolvedMa(period);
          return (
            <TableGrid.Row key={period}>
              <TableGrid.Cell width="5.6rem">
                <input
                  type="checkbox"
                  checked={ma.enabled}
                  disabled={isSaving}
                  onChange={(event) => onMaChange(period, 'enabled', event.target.checked)}
                  aria-label={`${MA_LABEL[period]} 표시`}
                />
              </TableGrid.Cell>
              <TableGrid.Cell width="6.4rem">{MA_LABEL[period]}</TableGrid.Cell>
              <TableGrid.Cell width="5.6rem" style={CELL_FLUSH_STYLE}>
                <input
                  type="color"
                  value={colorToHex(ma.color)}
                  disabled={isSaving}
                  onChange={(event) => onMaChange(period, 'color', event.target.value)}
                  aria-label={`${MA_LABEL[period]} 색상`}
                  style={colorInputStyle}
                />
              </TableGrid.Cell>
              <TableGrid.Cell width="8.8rem" style={CELL_FLUSH_STYLE}>
                <NumberInput
                  dense
                  showSpinner
                  min={1}
                  max={5}
                  step={1}
                  value={String(ma.width)}
                  disabled={isSaving}
                  onValueChange={(raw) => {
                    const next = Number(raw);
                    if (Number.isFinite(next) && next >= 1 && next <= 5) {
                      onMaChange(period, 'width', next);
                    }
                  }}
                  aria-label={`${MA_LABEL[period]} 두께`}
                />
              </TableGrid.Cell>
              <TableGrid.Cell width="12rem" style={CELL_FLUSH_STYLE}>
                <Select
                  dense
                  value={ma.style}
                  disabled={isSaving}
                  onChange={(event) =>
                    onMaChange(period, 'style', event.target.value as LineStyleType)
                  }
                  aria-label={`${MA_LABEL[period]} 스타일`}
                  style={{ width: '100%' }}
                >
                  {LINE_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </TableGrid.Cell>
              <TableGrid.Cell flex={1}> </TableGrid.Cell>
            </TableGrid.Row>
          );
        })}
      </TableGrid.Body>
    </TableGrid.Root>
  </div>
);
