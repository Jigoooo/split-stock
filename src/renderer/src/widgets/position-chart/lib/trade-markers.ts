import type { TradeCycle } from '@renderer/entities/trade-cycle';
import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Candle } from '../model/candle-types';

const BUY_COLOR = '#d73333';
const SELL_COLOR = '#2d4fca';

/**
 * 차수가 깊어질수록 채도/투명도를 낮춰 시각적 무게를 차등.
 * 1차=1.0, 2차=0.92, ... clamp 0.55. 줌아웃으로 마커가 뭉쳐도
 * 색 농도만으로 1차/막차를 구분 가능.
 */
function tintByNth(hex: string, nth: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const raw = m[1] ?? '';
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const alpha = Math.max(0.55, 1 - (nth - 1) * 0.08);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

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
    // Q-D: BUYING (미체결 매수 진행 중) 차수는 marker 완전 숨김 — 체결 후에만 표시.
    if (cycle.status !== 'BUYING' && typeof cycle.boughtAt === 'number') {
      const candleDate = findCandleDateAtOrBefore(candles, msToYmdKst(cycle.boughtAt));
      if (candleDate) {
        markers.push({
          time: candleDate as Time,
          position: 'belowBar',
          color: tintByNth(BUY_COLOR, cycle.nth),
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
          color: tintByNth(SELL_COLOR, cycle.nth),
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
