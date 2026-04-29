import type { TradeCycle } from '@renderer/entities/trade-cycle';
import { describe, expect, it } from 'vitest';
import type { Candle } from '../model/candle-types';
import { toTradeMarkers } from './trade-markers';

const candle = (date: string): Candle => ({
  date,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1000,
});

const candlesYmd = (...dates: string[]): Candle[] => dates.map(candle);

const ymdToMsKst = (ymd: string): number => {
  const parts = ymd.split('-').map(Number) as [number, number, number];
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0).getTime();
};

const cycle = (overrides: Partial<TradeCycle>): TradeCycle => ({
  id: 1,
  nth: 1,
  pdno: '005930',
  name: '삼성전자',
  buyPrice: 70_000,
  qty: 10,
  amountKrw: 700_000,
  status: 'OPEN',
  boughtAt: ymdToMsKst('2026-04-10'),
  ...overrides,
});

describe('toTradeMarkers', () => {
  it('빈 cycles 또는 빈 candles 면 빈 배열을 반환한다', () => {
    expect(toTradeMarkers([], candlesYmd('2026-04-10'))).toEqual([]);
    expect(toTradeMarkers([cycle({})], [])).toEqual([]);
  });

  it('OPEN 차수는 BUY 마커만 belowBar 에 B{nth} 로 추가한다', () => {
    const candles = candlesYmd('2026-04-09', '2026-04-10', '2026-04-11');
    const markers = toTradeMarkers(
      [cycle({ nth: 1, boughtAt: ymdToMsKst('2026-04-10'), status: 'OPEN' })],
      candles,
    );
    expect(markers).toEqual([
      {
        time: '2026-04-10',
        position: 'belowBar',
        color: 'rgba(215, 51, 51, 1.00)',
        shape: 'arrowUp',
        text: 'B1',
      },
    ]);
  });

  it('SOLD 차수는 BUY+SELL 두 마커를 만들고 SELL 은 aboveBar S{nth}', () => {
    const candles = candlesYmd('2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11');
    const markers = toTradeMarkers(
      [
        cycle({
          nth: 2,
          status: 'SOLD',
          boughtAt: ymdToMsKst('2026-04-08'),
          soldAt: ymdToMsKst('2026-04-11'),
          sellPrice: 75_000,
        }),
      ],
      candles,
    );
    expect(markers).toEqual([
      {
        time: '2026-04-08',
        position: 'belowBar',
        color: 'rgba(215, 51, 51, 0.92)',
        shape: 'arrowUp',
        text: 'B2',
      },
      {
        time: '2026-04-11',
        position: 'aboveBar',
        color: 'rgba(45, 79, 202, 0.92)',
        shape: 'arrowDown',
        text: 'S2',
      },
    ]);
  });

  it('체결일이 캔들 사이의 휴장일이면 직전 영업일 캔들에 마커를 붙인다', () => {
    // 2026-04-10(금) 매수, 주말(2026-04-11/12) 캔들 없음 → 2026-04-10 캔들에 부착.
    const candles = candlesYmd('2026-04-10', '2026-04-13');
    const markers = toTradeMarkers(
      [cycle({ nth: 1, boughtAt: ymdToMsKst('2026-04-11'), status: 'OPEN' })],
      candles,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]?.time).toBe('2026-04-10');
  });

  it('체결일이 가장 오래된 캔들보다도 이전이면 해당 마커는 생략된다', () => {
    const candles = candlesYmd('2026-04-10', '2026-04-11');
    const markers = toTradeMarkers(
      [cycle({ nth: 1, boughtAt: ymdToMsKst('2026-01-01'), status: 'OPEN' })],
      candles,
    );
    expect(markers).toEqual([]);
  });

  it('SOLD 라도 soldAt 이 없으면 SELL 마커를 만들지 않는다', () => {
    const candles = candlesYmd('2026-04-10');
    const markers = toTradeMarkers(
      [
        cycle({
          nth: 1,
          status: 'SOLD',
          boughtAt: ymdToMsKst('2026-04-10'),
          soldAt: undefined,
          sellPrice: 75_000,
        }),
      ],
      candles,
    );
    expect(markers.map((m) => m.text)).toEqual(['B1']);
  });

  it('여러 차수의 마커는 시각 오름차순으로 정렬된다', () => {
    const candles = candlesYmd('2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11');
    const markers = toTradeMarkers(
      [
        cycle({
          nth: 1,
          status: 'SOLD',
          boughtAt: ymdToMsKst('2026-04-08'),
          soldAt: ymdToMsKst('2026-04-11'),
          sellPrice: 75_000,
        }),
        cycle({ nth: 2, boughtAt: ymdToMsKst('2026-04-10'), status: 'OPEN' }),
      ],
      candles,
    );
    expect(markers.map((m) => `${m.text}@${String(m.time)}`)).toEqual([
      'B1@2026-04-08',
      'B2@2026-04-10',
      'S1@2026-04-11',
    ]);
  });

  it('BUYING / SELLING 진행 중 차수의 BUY 마커는 boughtAt 이 있으면 표시된다', () => {
    const candles = candlesYmd('2026-04-10');
    const markers = toTradeMarkers(
      [
        cycle({ nth: 1, status: 'BUYING', boughtAt: ymdToMsKst('2026-04-10') }),
        cycle({ nth: 2, status: 'SELLING', boughtAt: ymdToMsKst('2026-04-10') }),
      ],
      candles,
    );
    expect(markers.map((m) => m.text)).toEqual(['B1', 'B2']);
  });
});
