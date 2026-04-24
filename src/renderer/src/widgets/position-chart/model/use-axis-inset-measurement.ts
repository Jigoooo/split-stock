import type { IChartApi } from 'lightweight-charts';
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react';
import type { Candle } from './use-position-chart';

interface UseAxisInsetMeasurementParams {
  candles: Candle[];
  chartRef: RefObject<IChartApi | null>;
  setAxisRightInset: Dispatch<SetStateAction<number>>;
}

export function useAxisInsetMeasurement({
  candles,
  chartRef,
  setAxisRightInset,
}: UseAxisInsetMeasurementParams): void {
  const lastCandle = candles.at(-1);
  const measureKey = lastCandle
    ? `${candles.length}:${lastCandle.date}:${lastCandle.high}:${lastCandle.low}:${lastCandle.close}`
    : '0';

  useEffect(() => {
    void measureKey;
    const chart = chartRef.current;
    if (!chart) return;
    const id = requestAnimationFrame(() => {
      try {
        const width = chart.priceScale('right').width();
        setAxisRightInset(Math.max(24, Math.ceil(width) + 8));
      } catch {
        // chart may already be torn down in tests or during fast unmounts.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [chartRef, measureKey, setAxisRightInset]);
}
