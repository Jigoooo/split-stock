import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import type { ReactElement } from 'react';
import { type ChartPeriod, usePositionChart } from '../model/use-position-chart';
import { CandlestickChart } from './candlestick-chart';

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

export interface PositionChartProps {
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

export const PositionChart = ({ pdno, name, lines }: PositionChartProps): ReactElement => {
  const chart = usePositionChart(pdno);

  return (
    <div
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}
      >
        <span>
          {name} ({pdno})
        </span>
        {chart.isLoading ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <div role="tablist" aria-label="봉 단위" style={{ display: 'flex', gap: '0.3rem' }}>
          {(['D', 'W', 'M'] as const).map((period) => (
            <button
              key={period}
              type="button"
              role="tab"
              aria-selected={chart.period === period}
              className={chart.period === period ? 'hts-btn hts-btn--primary' : 'hts-btn'}
              onClick={() => chart.setPeriod(period)}
              style={{ padding: '0.3rem 0.7rem' }}
            >
              {PERIOD_LABEL[period]}
            </button>
          ))}
        </div>
      </div>
      <div
        className="panel__body"
        style={{
          padding: '0.6rem',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {chart.error ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              flexWrap: 'wrap',
              marginBottom: '0.6rem',
            }}
          >
            <span className="chip chip--down">{chart.error}</span>
            <button
              type="button"
              className="hts-btn"
              onClick={chart.retry}
              disabled={chart.isLoading}
              aria-label="봉 다시 시도"
            >
              다시 시도
            </button>
          </div>
        ) : null}
        <CandlestickChart
          candles={chart.candles}
          lines={lines}
          onFetchMore={chart.fetchMore}
          reachedEnd={chart.reachedEnd}
        />
      </div>
    </div>
  );
};
