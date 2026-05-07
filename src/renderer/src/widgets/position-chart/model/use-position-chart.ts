import { useLiveTick } from '@renderer/entities/realtime';
import { useState } from 'react';
import { buildDailyLiveCandle } from '../lib/position-chart-helpers';
import type { Candle, ChartPeriod } from './candle-types';
import { usePositionChartCandles } from './use-position-chart-candles';

export { buildDailyLiveCandle } from '../lib/position-chart-helpers';
// re-export: 기존 외부 소비자(test)가 './use-position-chart' 에서 가져가던 심볼 유지.
export type { Candle, ChartPeriod } from './candle-types';

export interface UsePositionChartResult {
  candles: Candle[];
  liveCandle: Candle | null;
  error: string | null;
  fetchMore: () => Promise<void>;
  isAutoRecovering: boolean;
  isLoading: boolean;
  period: ChartPeriod;
  reachedEnd: boolean;
  retry: () => void;
  setPeriod: (period: ChartPeriod) => void;
}

/**
 * Position chart facade.
 * - period state (UI 모드)
 * - candles fetch/pagination/cache → usePositionChartCandles 위임
 * - 일봉 live tick → useLiveTick + buildDailyLiveCandle 합성
 */
export function usePositionChart(pdno: string): UsePositionChartResult {
  const [period, setPeriod] = useState<ChartPeriod>('D');
  const candlesState = usePositionChartCandles(pdno, period);

  const rawTick = useLiveTick(pdno, 1000);
  const liveCandle = buildDailyLiveCandle(candlesState.candles, rawTick, period);

  return {
    ...candlesState,
    liveCandle,
    period,
    setPeriod,
  };
}
