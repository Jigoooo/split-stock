import type { IChartApi } from 'lightweight-charts';
import { type RefObject, useEffect, useEffectEvent } from 'react';
import {
  HISTORY_FETCH_REARM_BARS,
  HISTORY_FETCH_TRIGGER_BARS,
} from '../config/candlestick-chart-config';

interface UseHistoryFetchParams {
  chartRef: RefObject<IChartApi | null>;
  historyFetchArmedRef: RefObject<boolean>;
  onFetchMore: () => Promise<void>;
  reachedEnd: boolean;
}

export function useHistoryFetch({
  chartRef,
  historyFetchArmedRef,
  onFetchMore,
  reachedEnd,
}: UseHistoryFetchParams): void {
  const onFetchMoreEvent = useEffectEvent(onFetchMore);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const onRangeChange = (range: { from: number; to: number } | null): void => {
      if (!range || reachedEnd) return;
      if (range.from > HISTORY_FETCH_REARM_BARS) {
        if (!historyFetchArmedRef.current) {
          historyFetchArmedRef.current = true;
        }
        return;
      }
      if (range.from > HISTORY_FETCH_TRIGGER_BARS) return;
      if (!historyFetchArmedRef.current) return;
      historyFetchArmedRef.current = false;
      void onFetchMoreEvent();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
    };
  }, [chartRef, historyFetchArmedRef, reachedEnd]);
}
