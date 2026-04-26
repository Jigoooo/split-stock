import type { TradeCycle } from '@renderer/entities/trade-cycle';
import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Candle } from '../model/candle-types';

const BUY_COLOR = '#d73333';
const SELL_COLOR = '#2d4fca';

function msToYmdKst(ms: number): string {
  const date = new Date(ms);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findCandleDateAtOrBefore(candles: readonly Candle[], targetYmd: string): string | null {
  let best: string | null = null;
  for (const candle of candles) {
    if (candle.date <= targetYmd) best = candle.date;
    else break;
  }
  return best;
}

export function toTradeMarkers(
  cycles: readonly TradeCycle[],
  candles: readonly Candle[],
): SeriesMarker<Time>[] {
  if (candles.length === 0 || cycles.length === 0) return [];

  const markers: SeriesMarker<Time>[] = [];

  for (const cycle of cycles) {
    if (typeof cycle.boughtAt === 'number') {
      const candleDate = findCandleDateAtOrBefore(candles, msToYmdKst(cycle.boughtAt));
      if (candleDate) {
        markers.push({
          time: candleDate as Time,
          position: 'belowBar',
          color: BUY_COLOR,
          shape: 'arrowUp',
          text: `B${cycle.nth}`,
        });
      }
    }

    if (cycle.status === 'SOLD' && typeof cycle.soldAt === 'number') {
      const candleDate = findCandleDateAtOrBefore(candles, msToYmdKst(cycle.soldAt));
      if (candleDate) {
        markers.push({
          time: candleDate as Time,
          position: 'aboveBar',
          color: SELL_COLOR,
          shape: 'arrowDown',
          text: `S${cycle.nth}`,
        });
      }
    }
  }

  return markers.sort((a, b) => {
    const aTime = a.time as string;
    const bTime = b.time as string;
    if (aTime === bTime) return 0;
    return aTime < bTime ? -1 : 1;
  });
}
