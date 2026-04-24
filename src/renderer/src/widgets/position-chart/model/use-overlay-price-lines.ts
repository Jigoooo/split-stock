import { LineStyle } from 'lightweight-charts';
import { useEffect } from 'react';
import { formatOverlayLineTitle } from '../lib/candlestick-chart-format';
import type { CandlestickChartRefs } from './candlestick-chart-types';
import type { Candle } from './use-position-chart';

interface UseOverlayPriceLinesParams
  extends Pick<CandlestickChartRefs, 'priceLinesRef' | 'seriesRef'> {
  candles: Candle[];
  lines: Array<{ kind: 'buy' | 'sell-target'; nth: number; label: string; price: number }>;
}

export function useOverlayPriceLines({
  candles,
  lines,
  priceLinesRef,
  seriesRef,
}: UseOverlayPriceLinesParams): void {
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (candles.length === 0) {
      for (const priceLine of priceLinesRef.current) {
        try {
          series.removePriceLine(priceLine);
        } catch {
          // ignore
        }
      }
      priceLinesRef.current = [];
      return;
    }

    for (const priceLine of priceLinesRef.current) {
      series.removePriceLine(priceLine);
    }

    priceLinesRef.current = lines.map((line) => {
      const roundedPrice = Math.round(line.price);
      return series.createPriceLine({
        price: roundedPrice,
        color: line.kind === 'buy' ? '#d73333' : '#2d4fca',
        lineWidth: 1,
        lineStyle: line.kind === 'buy' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: formatOverlayLineTitle({ ...line, price: roundedPrice }),
      });
    });

    return () => {
      for (const priceLine of priceLinesRef.current) {
        try {
          series.removePriceLine(priceLine);
        } catch {
          // ignore
        }
      }
      priceLinesRef.current = [];
    };
  }, [candles.length, lines, priceLinesRef, seriesRef]);
}
