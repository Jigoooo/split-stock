import type {
  CrosshairModeType,
  LineStyleType,
  MaPeriod,
  MaSettings,
} from '@renderer/entities/display-settings';
import { MA_PERIODS } from '@renderer/entities/display-settings';
import { Button, Select, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

const MA_LABEL: Record<MaPeriod, string> = {
  5: 'MA5',
  10: 'MA10',
  20: 'MA20',
  60: 'MA60',
  120: 'MA120',
};

const LINE_STYLE_OPTIONS: Array<{ value: LineStyleType; label: string }> = [
  { value: 'solid', label: '실선' },
  { value: 'dashed', label: '점선' },
  { value: 'dotted', label: '점' },
];

interface ChartSettingsFormProps {
  resolvedMa: (period: MaPeriod) => MaSettings;
  resolvedVolume: { upColor: string; downColor: string; heightPercent: number };
  resolvedCrosshair: { mode: CrosshairModeType; labelVisible: boolean };
  isSaving: boolean;
  onMaChange: <K extends keyof MaSettings>(
    period: MaPeriod,
    field: K,
    value: MaSettings[K],
  ) => void;
  onVolumeChange: <K extends 'upColor' | 'downColor' | 'heightPercent'>(
    field: K,
    value: K extends 'heightPercent' ? number : string,
  ) => void;
  onCrosshairChange: <K extends 'mode' | 'labelVisible'>(
    field: K,
    value: K extends 'labelVisible' ? boolean : CrosshairModeType,
  ) => void;
  onSave: () => void;
  onReset: () => void;
}

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
}: ChartSettingsFormProps): ReactElement => {
  return (
    <section aria-label="차트 설정" style={{ display: 'grid', gap: '1.2rem' }}>
      {/* ── 이동평균선 ── */}
      <div>
        <div
          className="muted"
          style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}
        >
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
                      onChange={(e) => onMaChange(period, 'enabled', e.target.checked)}
                      aria-label={`${MA_LABEL[period]} 표시`}
                    />
                  </TableGrid.Cell>
                  <TableGrid.Cell width={64}>{MA_LABEL[period]}</TableGrid.Cell>
                  <TableGrid.Cell width={96}>
                    <input
                      type="color"
                      value={ma.color.startsWith('rgba') ? '#888888' : ma.color}
                      disabled={isSaving}
                      onChange={(e) => onMaChange(period, 'color', e.target.value)}
                      aria-label={`${MA_LABEL[period]} 색상`}
                      style={{
                        width: '4rem',
                        height: '2.4rem',
                        padding: '0.1rem',
                        border: '0.1rem solid var(--border-strong)',
                        borderRadius: '0.3rem',
                        cursor: 'pointer',
                      }}
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
                      onChange={(e) => onMaChange(period, 'width', Number(e.target.value))}
                      aria-label={`${MA_LABEL[period]} 두께`}
                      style={{ width: '4rem' }}
                    />
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1}>
                    <Select
                      dense
                      value={ma.style}
                      disabled={isSaving}
                      onChange={(e) => onMaChange(period, 'style', e.target.value as LineStyleType)}
                      aria-label={`${MA_LABEL[period]} 스타일`}
                    >
                      {LINE_STYLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
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

      {/* ── 거래량 ── */}
      <div>
        <div
          className="muted"
          style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}
        >
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
            onChange={(e) => onVolumeChange('upColor', e.target.value)}
            style={{
              width: '4rem',
              height: '2.4rem',
              padding: '0.1rem',
              border: '0.1rem solid var(--border-strong)',
              borderRadius: '0.3rem',
              cursor: 'pointer',
            }}
          />
          <span />

          <label htmlFor="vol-down-color" style={{ fontSize: '1.1rem' }}>
            하락 색상
          </label>
          <input
            id="vol-down-color"
            type="color"
            value={
              resolvedVolume.downColor.startsWith('rgba') ? '#2563eb' : resolvedVolume.downColor
            }
            disabled={isSaving}
            onChange={(e) => onVolumeChange('downColor', e.target.value)}
            style={{
              width: '4rem',
              height: '2.4rem',
              padding: '0.1rem',
              border: '0.1rem solid var(--border-strong)',
              borderRadius: '0.3rem',
              cursor: 'pointer',
            }}
          />
          <span />

          <label htmlFor="vol-height" style={{ fontSize: '1.1rem' }}>
            높이 비율 (%)
          </label>
          <input
            id="vol-height"
            type="number"
            className="hts-input hts-input--dense hts-input--num"
            min={10}
            max={60}
            value={resolvedVolume.heightPercent}
            disabled={isSaving}
            onChange={(e) => onVolumeChange('heightPercent', Number(e.target.value))}
            style={{ width: '5rem' }}
          />
          <span className="muted" style={{ fontSize: '1rem' }}>
            10~60%
          </span>
        </div>
      </div>

      {/* ── 크로스헤어 ── */}
      <div>
        <div
          className="muted"
          style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.6rem' }}
        >
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
            onChange={(e) => onCrosshairChange('mode', e.target.value as CrosshairModeType)}
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
            onChange={(e) => onCrosshairChange('labelVisible', e.target.checked)}
            aria-label="크로스헤어 축 라벨 표시"
          />
          <span className="muted" style={{ fontSize: '1rem' }}>
            가격 축과 시간 축의 현재 위치 라벨을 함께 표시합니다.
          </span>
        </div>
      </div>

      {/* ── 버튼 ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
        <Button
          onClick={onReset}
          disabled={isSaving}
          variant="default"
          dense
          aria-label="차트 설정 초기화"
        >
          초기화
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving}
          variant="primary"
          dense
          aria-label="차트 설정 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
