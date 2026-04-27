import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';
import type { LotNthBar } from '../model/use-reports';

export interface LotNthBarChartProps {
  bars: LotNthBar[];
  height?: number;
}

/**
 * 차수별 손익 분포 — CSS 막대 차트 (lightweight-charts HistogramSeries 대안).
 * 단순 카테고리(nth) → 합계 표시이므로 캔버스 차트보다 div bar 가 효율적.
 * 양수 / 음수 구분: HTS 색상 토큰 (--up / --down).
 */
export const LotNthBarChart = ({ bars, height = 200 }: LotNthBarChartProps): ReactElement => {
  if (bars.length === 0) {
    return (
      <div
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        className="muted"
      >
        선택한 기간에 차수별 손익 데이터가 없습니다.
      </div>
    );
  }

  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.pnlKrw)));

  return (
    <div
      role="img"
      aria-label="차수별 손익 분포"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${bars.length}, minmax(48px, 1fr))`,
        gap: '0.6rem',
        alignItems: 'end',
        height,
        padding: '0 0.4rem',
      }}
    >
      {bars.map((bar) => {
        const ratio = Math.abs(bar.pnlKrw) / maxAbs;
        const isPositive = bar.pnlKrw >= 0;
        const barHeight = `${ratio * 70}%`;
        return (
          <div
            key={bar.nth}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.3rem',
              height: '100%',
            }}
          >
            <span
              className="num"
              style={{
                fontSize: '0.85em',
                color: isPositive ? 'var(--up)' : 'var(--down)',
                fontWeight: 600,
              }}
              title={`${bar.nth}차 — ${bar.tradeCount}건`}
            >
              {bar.pnlKrw >= 0 ? '+' : ''}
              {thousandSeparator(Math.round(bar.pnlKrw))}
            </span>
            <div
              style={{
                width: '100%',
                flex: 1,
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: barHeight,
                  background: isPositive ? 'var(--up)' : 'var(--down)',
                  borderRadius: '0.2rem',
                  opacity: 0.85,
                }}
              />
            </div>
            <span className="muted" style={{ fontSize: '0.85em' }}>
              {bar.nth}차
            </span>
          </div>
        );
      })}
    </div>
  );
};
