import type { DisplaySettings, MaPeriod } from '@renderer/entities/display-settings';
import { MA_PERIODS } from '@renderer/entities/display-settings';
import {
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../model/use-position-chart';

type LineStyleMap = { solid: number; dashed: number; dotted: number };

export const LINE_STYLE_MAP: LineStyleMap = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

export const MA_PERIODS_CONST = MA_PERIODS as MaPeriod[];

function timeToDate(time: Time): Date | null {
  if (typeof time === 'string') {
    if (time.includes('T')) return new Date(time);
    return new Date(`${time}T00:00:00`);
  }
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }
  if (time && typeof time === 'object' && 'year' in time) {
    return new Date(time.year, time.month - 1, time.day);
  }
  return null;
}

export function candleDateToTime(date: string): Time {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = Date.parse(date);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000) as UTCTimestamp;
  return date;
}

export function candleDateToTimeKey(date: string): string {
  return String(candleDateToTime(date));
}

export function formatTickKr(time: Time, tickType: TickMarkType): string {
  const date = timeToDate(time);
  if (!date) return '';
  switch (tickType) {
    case TickMarkType.Year:
      return `${date.getFullYear()}`;
    case TickMarkType.Month:
      return `${date.getMonth() + 1}월`;
    case TickMarkType.DayOfMonth:
      return `${date.getDate()}`;
    case TickMarkType.Time:
    case TickMarkType.TimeWithSeconds:
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    default:
      return '';
  }
}

export function formatCrosshairDateKr(time: Time): string {
  const date = timeToDate(time);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  if (hour === '00' && minute === '00') return `${year}-${month}-${day}`;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function formatOverlayLineTitle(line: {
  kind: 'buy' | 'sell-target';
  nth: number;
  price: number;
}): string {
  const roundedPrice = Math.round(line.price).toLocaleString('ko-KR');
  return line.kind === 'buy'
    ? `${line.nth}차 매수 ${roundedPrice}`
    : `${line.nth}차 익절선 ${roundedPrice}`;
}

export function computeMa(
  candles: Candle[],
  period: MaPeriod,
): Array<{ time: Time; value: number }> {
  const result: Array<{ time: Time; value: number }> = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j]?.close ?? 0;
    }
    const date = candles[i]?.date;
    if (date !== undefined) {
      result.push({ time: candleDateToTime(date), value: sum / period });
    }
  }
  return result;
}

export function resolveCrosshairOptions(displaySettings?: DisplaySettings | null) {
  const crosshair = displaySettings?.chart.crosshair;
  const labelVisible = crosshair?.labelVisible ?? true;
  return {
    mode: crosshair?.mode === 'Normal' ? CrosshairMode.Normal : CrosshairMode.Magnet,
    vertLine: { labelVisible },
    horzLine: { labelVisible },
  };
}
