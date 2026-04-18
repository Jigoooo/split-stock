import { describe, expect, it } from 'vitest';
import { evaluate, type PositionSnapshot, type TradingConfig } from './fsm';

const cfg: TradingConfig = {
  pdno: '005930',
  totalAmountKrw: 5_000_000,
  maxStages: 5,
  dropPct: 0.03,
  profitPct: 0.05,
};

function pos(lots: PositionSnapshot['lots']): PositionSnapshot {
  return { pdno: cfg.pdno, lots };
}

describe('evaluate — 시드 매수', () => {
  it('빈 포지션 + 합리 가격 → 1차 매수, qty = floor(amountPerStage / price)', () => {
    const orders = evaluate(70000, pos([]), cfg);
    expect(orders).toHaveLength(1);
    const [o] = orders;
    if (!o) throw new Error('no order');
    expect(o.kind).toBe('BUY');
    expect(o.nth).toBe(1);
    // 5_000_000 / 5 = 1_000_000; floor(1_000_000 / 70000) = 14
    expect(o.qty).toBe(14);
  });

  it('시드: 현재가가 amountPerStage보다 크면 qty=0 → 주문 없음', () => {
    const orders = evaluate(2_000_000, pos([]), cfg);
    expect(orders).toHaveLength(0);
  });
});

describe('evaluate — 정상 하향매수', () => {
  it('직전 차수 -3% 도달 → 다음 차수 BUY 생성', () => {
    const snapshot = pos([{ nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' }]);
    // 70000 * 0.97 = 67900
    const orders = evaluate(67800, snapshot, cfg);
    const buy = orders.find((o) => o.kind === 'BUY');
    expect(buy).toBeDefined();
    expect(buy?.nth).toBe(2);
    expect(buy?.qty).toBe(Math.floor(1_000_000 / 67800));
  });

  it('트리거 미만(가격이 아직 높음) → 매수 주문 없음', () => {
    const snapshot = pos([{ nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' }]);
    const orders = evaluate(69000, snapshot, cfg); // 아직 -3% 미달
    expect(orders.filter((o) => o.kind === 'BUY')).toHaveLength(0);
  });
});

describe('evaluate — 독립 익절', () => {
  it('특정 차수만 +5% 도달 → 해당 차수만 SELL', () => {
    const snapshot = pos([
      { nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' }, // trigger 73500
      { nth: 2, buyPrice: 67800, qty: 14, status: 'OPEN' }, // trigger 71190
    ]);
    const orders = evaluate(72000, snapshot, cfg);
    const sells = orders.filter((o) => o.kind === 'SELL');
    expect(sells).toHaveLength(1); // 2차만 익절
    expect(sells[0]?.nth).toBe(2);
    expect(sells[0]?.qty).toBe(14);
  });

  it('양차수 동시에 +5% 이상 → 둘 다 SELL', () => {
    const snapshot = pos([
      { nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' },
      { nth: 2, buyPrice: 67800, qty: 14, status: 'OPEN' },
    ]);
    const orders = evaluate(74000, snapshot, cfg); // 두 차수 모두 익절
    const sells = orders.filter((o) => o.kind === 'SELL');
    expect(sells).toHaveLength(2);
  });
});

describe('evaluate — 최대 차수 캡', () => {
  it('N차 도달 시 추가 BUY 생성 불가', () => {
    const lots = Array.from({ length: cfg.maxStages }, (_, i) => ({
      nth: i + 1,
      buyPrice: 70000 - i * 2100, // 하락 스택
      qty: 10,
      status: 'OPEN' as const,
    }));
    const snapshot = pos(lots);
    const lowPrice = 1; // 트리거는 충분히 충족
    const orders = evaluate(lowPrice, snapshot, cfg);
    expect(orders.filter((o) => o.kind === 'BUY')).toHaveLength(0);
  });
});

describe('evaluate — 반등 후 2차 익절', () => {
  it('1차 매도 완료 후(SOLD), 2차 OPEN만 평가되어 익절', () => {
    const snapshot = pos([
      { nth: 1, buyPrice: 70000, qty: 14, status: 'SOLD' },
      { nth: 2, buyPrice: 67800, qty: 14, status: 'OPEN' },
    ]);
    const orders = evaluate(71500, snapshot, cfg);
    const sells = orders.filter((o) => o.kind === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0]?.nth).toBe(2);
  });
});

describe('evaluate — 주수 산출', () => {
  it('floor 내림 적용 — 남는 원화는 버림', () => {
    const smallCfg: TradingConfig = {
      pdno: '005930',
      totalAmountKrw: 300_001, // /3 = 100000.33
      maxStages: 3,
      dropPct: 0.03,
      profitPct: 0.05,
    };
    const orders = evaluate(30000, { pdno: '005930', lots: [] }, smallCfg);
    const [o] = orders;
    if (!o) throw new Error('no order');
    // amount per stage = floor(300001 / 3) = 100000; qty = floor(100000/30000) = 3
    expect(o.qty).toBe(3);
  });
});

describe('evaluate — 상태 경계', () => {
  it('BUYING 상태 차수가 있으면 추가 매수 억제', () => {
    const snapshot = pos([
      { nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' },
      { nth: 2, buyPrice: 67800, qty: 14, status: 'BUYING' },
    ]);
    const orders = evaluate(65000, snapshot, cfg);
    expect(orders.filter((o) => o.kind === 'BUY')).toHaveLength(0);
  });

  it('pdno mismatch → 주문 없음', () => {
    const orders = evaluate(70000, { pdno: '000660', lots: [] }, cfg);
    expect(orders).toHaveLength(0);
  });

  it('비정상 가격(0, 음수, NaN) → 주문 없음', () => {
    expect(evaluate(0, pos([]), cfg)).toHaveLength(0);
    expect(evaluate(-100, pos([]), cfg)).toHaveLength(0);
    expect(evaluate(Number.NaN, pos([]), cfg)).toHaveLength(0);
  });

  it('익절/추가매수 동시 성립 가능 (희귀): 매수 후 급반등 시나리오에서는 매수만 체크, 익절은 OPEN 차수 기준', () => {
    // 1차 OPEN, 가격이 -3%도, 1차 익절선(+5%)도 동시엔 불가능 (수학적으로). 여기서는 다단계 혼합을 검증.
    const snapshot = pos([
      { nth: 1, buyPrice: 70000, qty: 14, status: 'OPEN' }, // sell trigger 73500
      { nth: 2, buyPrice: 67800, qty: 14, status: 'OPEN' }, // buy trigger = 67800*0.97 = 65766, sell trigger 71190
    ]);
    // 가격 65000: 2차 기준 추가매수 성립 + 익절은 불가
    const orders = evaluate(65000, snapshot, cfg);
    expect(orders.some((o) => o.kind === 'BUY' && o.nth === 3)).toBe(true);
    expect(orders.some((o) => o.kind === 'SELL')).toBe(false);
  });
});
