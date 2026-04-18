import { describe, expect, it } from 'vitest';
import { parseEnvelope, parseH0STASP0, parseH0STCNT0 } from './ws-frame-parser';

/** H0STCNT0 46필드 샘플 생성 — index별 지정 값 + 나머지 '0'. */
function h0stcnt0Fields(overrides: Record<number, string> = {}): string {
  const fields = new Array(46).fill('0');
  for (const [k, v] of Object.entries(overrides)) fields[Number(k)] = v;
  return fields.join('^');
}

function h0stasp0Fields(overrides: Record<number, string> = {}): string {
  const fields = new Array(59).fill('0');
  for (const [k, v] of Object.entries(overrides)) fields[Number(k)] = v;
  return fields.join('^');
}

describe('parseEnvelope', () => {
  it('정상 구조 추출', () => {
    const frame = `0|H0STCNT0|1|${h0stcnt0Fields({ 0: '005930' })}`;
    const env = parseEnvelope(frame, 46);
    expect(env).not.toBeNull();
    expect(env?.trId).toBe('H0STCNT0');
    expect(env?.count).toBe(1);
    expect(env?.records).toHaveLength(1);
    expect(env?.records[0]?.[0]).toBe('005930');
  });

  it('필드 수 부족 → null', () => {
    const env = parseEnvelope('0|H0STCNT0|1|a^b^c', 46);
    expect(env).toBeNull();
  });

  it('count=0 또는 비정수 → null', () => {
    expect(parseEnvelope('0|H0STCNT0|0|x', 46)).toBeNull();
    expect(parseEnvelope('0|H0STCNT0|abc|x', 46)).toBeNull();
  });

  it('복수 레코드 chunk', () => {
    const payload = `${h0stcnt0Fields({ 0: 'A' })}^${h0stcnt0Fields({ 0: 'B' })}`;
    const env = parseEnvelope(`0|H0STCNT0|2|${payload}`, 46);
    expect(env?.records).toHaveLength(2);
    expect(env?.records[0]?.[0]).toBe('A');
    expect(env?.records[1]?.[0]).toBe('B');
  });
});

describe('parseH0STCNT0', () => {
  it('정상 필드 추출 + tick direction 매핑', () => {
    const frame = `0|H0STCNT0|1|${h0stcnt0Fields({
      0: '005930',
      1: '093015',
      2: '70500',
      3: '2', // UP
      4: '500',
      5: '0.71',
      7: '70000',
      8: '71000',
      9: '69800',
      10: '70600',
      11: '70500',
      12: '100',
      13: '15000000',
    })}`;
    const ticks = parseH0STCNT0(frame);
    expect(ticks).toHaveLength(1);
    const t = ticks[0];
    expect(t?.pdno).toBe('005930');
    expect(t?.price).toBe(70500);
    expect(t?.tickDirection).toBe('UP');
    expect(t?.bestAsk).toBe(70600);
    expect(t?.bestBid).toBe(70500);
    expect(t?.accumVolume).toBe(15_000_000);
  });

  it('tr_id 불일치 → 빈 배열', () => {
    expect(parseH0STCNT0(`0|H0STASP0|1|${h0stasp0Fields()}`)).toEqual([]);
  });

  it('비정상 필드 수 → 빈 배열', () => {
    expect(parseH0STCNT0('0|H0STCNT0|1|too^short')).toEqual([]);
  });

  it('복수 레코드 모두 정규화', () => {
    const rec1 = h0stcnt0Fields({ 0: '005930', 2: '70000' });
    const rec2 = h0stcnt0Fields({ 0: '000660', 2: '150000' });
    const frame = `0|H0STCNT0|2|${rec1}^${rec2}`;
    const ticks = parseH0STCNT0(frame);
    expect(ticks.map((t) => t.pdno)).toEqual(['005930', '000660']);
    expect(ticks.map((t) => t.price)).toEqual([70_000, 150_000]);
  });
});

describe('parseH0STASP0', () => {
  it('매도/매수 10단 + 잔량 쌍 결합', () => {
    const overrides: Record<number, string> = {
      0: '005930',
      1: '093015',
      43: '10000',
      44: '20000',
      47: '70400',
      48: '500',
    };
    for (let i = 0; i < 10; i++) {
      overrides[3 + i] = String(70500 + i * 100); // 매도 70500, 70600, ...
      overrides[13 + i] = String(70400 - i * 100); // 매수 70400, 70300, ...
      overrides[23 + i] = String(1000 + i); // 매도 잔량
      overrides[33 + i] = String(2000 + i); // 매수 잔량
    }
    const frame = `0|H0STASP0|1|${h0stasp0Fields(overrides)}`;
    const ob = parseH0STASP0(frame)[0];
    expect(ob?.pdno).toBe('005930');
    expect(ob?.asks).toHaveLength(10);
    expect(ob?.bids).toHaveLength(10);
    expect(ob?.asks[0]).toEqual({ price: 70500, quantity: 1000 });
    expect(ob?.asks[9]).toEqual({ price: 71400, quantity: 1009 });
    expect(ob?.bids[0]).toEqual({ price: 70400, quantity: 2000 });
    expect(ob?.bids[9]).toEqual({ price: 69500, quantity: 2009 });
    expect(ob?.totalAskQty).toBe(10_000);
    expect(ob?.totalBidQty).toBe(20_000);
    expect(ob?.expectedPrice).toBe(70_400);
  });

  it('tr_id 불일치 → 빈 배열', () => {
    expect(parseH0STASP0(`0|H0STCNT0|1|${h0stcnt0Fields()}`)).toEqual([]);
  });
});
