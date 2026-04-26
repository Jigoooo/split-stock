import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { CSSProperties, ReactElement } from 'react';
import type { OhlcTooltipState } from '../model/use-ohlc-tooltip';

interface OhlcTooltipProps {
  axisRightInset: number;
  state: OhlcTooltipState;
}

const ROI_W = 200;
const ROI_H = 90;
const UP_COLOR = '#d73333';
const DOWN_COLOR = '#2d4fca';
const NEUTRAL_COLOR = '#666';

const fmt = (n: number): string =>
  thousandSeparator(Math.round(n), { allowNegative: true, allowDecimal: false });

const Row = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): ReactElement => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
    <span style={{ color: '#666' }}>{label}</span>
    <span style={{ color: color ?? '#222' }}>{value}</span>
  </div>
);

export const OhlcTooltip = ({ axisRightInset, state }: OhlcTooltipProps): ReactElement | null => {
  const { visible, point, payload } = state;
  if (!visible || !payload || !point) return null;

  const dockRight = point.x < ROI_W && point.y < ROI_H;
  const positionStyle: CSSProperties = dockRight
    ? { right: axisRightInset + 8, top: 8 }
    : { left: 8, top: 8 };

  const delta = payload.prevClose !== null ? payload.close - payload.prevClose : null;
  const rate = delta !== null && payload.prevClose ? (delta / payload.prevClose) * 100 : null;
  const dir = delta === null || delta === 0 ? 0 : delta > 0 ? 1 : -1;
  const deltaColor = dir === 1 ? UP_COLOR : dir === -1 ? DOWN_COLOR : NEUTRAL_COLOR;
  const sign = dir === 1 ? '+' : dir === -1 ? '−' : '';
  // 종가 색은 전일 대비 등락 방향과 통일. prevClose 가 없으면 중립.
  const closeColor = dir === 0 ? undefined : deltaColor;

  return (
    <div
      data-testid="ohlc-tooltip"
      style={{
        position: 'absolute',
        ...positionStyle,
        zIndex: 3,
        pointerEvents: 'none',
        background: 'rgba(255,255,255,0.95)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        borderRadius: 4,
        padding: '6px 8px',
        fontSize: '1.1rem',
        lineHeight: 1.4,
        minWidth: 180,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{payload.date}</div>
      <Row label="시가" value={fmt(payload.open)} />
      <Row label="고가" value={fmt(payload.high)} color={UP_COLOR} />
      <Row label="저가" value={fmt(payload.low)} color={DOWN_COLOR} />
      {closeColor !== undefined ? (
        <Row label="종가" value={fmt(payload.close)} color={closeColor} />
      ) : (
        <Row label="종가" value={fmt(payload.close)} />
      )}
      {delta !== null && rate !== null ? (
        <Row
          label="등락"
          value={`${sign}${fmt(Math.abs(delta))} (${sign}${rate.toFixed(2)}%)`}
          color={deltaColor}
        />
      ) : null}
      <Row label="거래량" value={thousandSeparator(payload.volume)} />
    </div>
  );
};
