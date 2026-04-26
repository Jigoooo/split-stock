import {
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { CandlestickChartRefs } from './candlestick-chart-types';

interface UseTradeMarkersParams extends Pick<CandlestickChartRefs, 'seriesRef'> {
  markers: SeriesMarker<Time>[];
}

export function useTradeMarkers({ markers, seriesRef }: UseTradeMarkersParams): void {
  const pluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (pluginRef.current) {
      pluginRef.current.setMarkers(markers);
    } else {
      pluginRef.current = createSeriesMarkers(series, markers);
    }
  }, [markers, seriesRef]);

  useEffect(
    () => () => {
      try {
        pluginRef.current?.detach();
      } catch {
        // chart 제거가 먼저 발생한 경우 무시 (use-chart-instance cleanup 순서 의존).
      }
      pluginRef.current = null;
    },
    [],
  );
}
