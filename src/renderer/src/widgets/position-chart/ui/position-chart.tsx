import { useGetDisplaySettings } from '@renderer/entities/display-settings';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import type { LotOverlayLine } from '@shared/trading/lot-overlay';
import type { ReactElement } from 'react';
import { type ChartPeriod, usePositionChart } from '../model/use-position-chart';
import { CandlestickChart } from './candlestick-chart';
import { PriceChips } from './price-chips';

const PERIOD_LABEL: Record<ChartPeriod, string> = {
  D: '일',
  W: '주',
  M: '월',
};

export interface PositionChartProps {
  enableDrawingTools?: boolean;
  pdno: string;
  name: string;
  lines: LotOverlayLine[];
}

export const PositionChart = ({
  pdno,
  name,
  lines,
  enableDrawingTools = true,
}: PositionChartProps): ReactElement => {
  const chart = usePositionChart(pdno);
  const { settings: displaySettings } = useGetDisplaySettings();

  return (
    <div
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
    >
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}
      >
        <span>
          {name && name !== pdno ? (
            <>
              {name} ({pdno})
            </>
          ) : (
            pdno
          )}
        </span>
        <PriceChips pdno={pdno} />
        {chart.isLoading ? (
          <span className="muted" style={{ fontSize: '1rem' }}>
            로드 중…
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <SegmentedToggle
          value={chart.period}
          onChange={chart.setPeriod}
          ariaLabel="봉 단위"
          dense
          items={(['D', 'W', 'M'] as const).map((period) => ({
            value: period,
            label: PERIOD_LABEL[period],
          }))}
        />
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
            <Button
              onClick={chart.retry}
              disabled={chart.isLoading}
              aria-label="봉 다시 시도"
              dense
            >
              다시 시도
            </Button>
          </div>
        ) : null}
        <CandlestickChart
          candles={chart.candles}
          enableDrawingTools={enableDrawingTools}
          liveCandle={chart.liveCandle}
          lines={lines}
          onFetchMore={chart.fetchMore}
          pdno={pdno}
          reachedEnd={chart.reachedEnd}
          displaySettings={displaySettings}
        />
      </div>
    </div>
  );
};
