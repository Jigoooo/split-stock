import { createStrategyRules } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { evaluate, type PositionSnapshot, type TradingConfig } from './fsm';

const cfg: TradingConfig = {
  pdno: '005930',
  maxStages: 5,
  ...createStrategyRules(5, {
    amountKrw: 1_000_000,
    dropPct: 0.03,
    profitPct: 0.05,
  }),
};

function pos(lots: PositionSnapshot['lots']): PositionSnapshot {
  return { pdno: cfg.pdno, lots };
}

describe('evaluate — 1차 수동 진입', () => {
  it('빈 포지션이면 1차 자동매수를 만들지 않는다', () => {
    expect(evaluate(70_000, pos([]), cfg)).toEqual([]);
  });
});

describe('evaluate — 차수별 추가매수', () => {
  it('직전 차수 -3% 도달 시 다음 차수 규칙의 금액으로 BUY를 만든다', () => {
    const orders = evaluate(
      67_800,
      pos([{ nth: 1, buyPrice: 70_000, qty: 14, status: 'OPEN' }]),
      cfg,
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      kind: 'BUY',
      nth: 2,
      qty: Math.floor(1_000_000 / 67_800),
    });
  });

  it('다음 차수 규칙이 없거나 최대 차수면 추가매수하지 않는다', () => {
    const snapshot = pos(
      Array.from({ length: cfg.maxStages }, (_, index) => ({
        nth: index + 1,
        buyPrice: 70_000 - index * 2_000,
        qty: 10,
        status: 'OPEN' as const,
      })),
    );
    expect(evaluate(1, snapshot, cfg).filter((order) => order.kind === 'BUY')).toHaveLength(0);
  });

  it('BUYING 차수가 있으면 추가매수를 억제한다', () => {
    const snapshot = pos([
      { nth: 1, buyPrice: 70_000, qty: 14, status: 'OPEN' },
      { nth: 2, buyPrice: 67_800, qty: 14, status: 'BUYING' },
    ]);
    expect(evaluate(65_000, snapshot, cfg).filter((order) => order.kind === 'BUY')).toHaveLength(0);
  });
});

describe('evaluate — 차수별 익절', () => {
  it('특정 차수 sellRule 목표가를 넘으면 해당 차수만 SELL한다', () => {
    const orders = evaluate(
      72_000,
      pos([
        { nth: 1, buyPrice: 70_000, qty: 14, status: 'OPEN' },
        { nth: 2, buyPrice: 67_800, qty: 14, status: 'OPEN' },
      ]),
      cfg,
    );
    const sells = orders.filter((order) => order.kind === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0]?.nth).toBe(2);
  });

  it('여러 차수 목표가를 동시에 넘으면 각 차수 SELL을 모두 만든다', () => {
    const orders = evaluate(
      74_000,
      pos([
        { nth: 1, buyPrice: 70_000, qty: 14, status: 'OPEN' },
        { nth: 2, buyPrice: 67_800, qty: 14, status: 'OPEN' },
      ]),
      cfg,
    );
    expect(orders.filter((order) => order.kind === 'SELL')).toHaveLength(2);
  });

  it('SOLD lot은 건너뛰고 OPEN lot만 익절 평가한다', () => {
    const orders = evaluate(
      71_500,
      pos([
        { nth: 1, buyPrice: 70_000, qty: 14, status: 'SOLD' },
        { nth: 2, buyPrice: 67_800, qty: 14, status: 'OPEN' },
      ]),
      cfg,
    );
    const sells = orders.filter((order) => order.kind === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0]?.nth).toBe(2);
  });
});

describe('evaluate — 경계값', () => {
  it('pdno mismatch면 주문이 없다', () => {
    expect(evaluate(70_000, { pdno: '000660', lots: [] }, cfg)).toEqual([]);
  });

  it('비정상 가격이면 주문이 없다', () => {
    expect(evaluate(0, pos([]), cfg)).toEqual([]);
    expect(evaluate(-1, pos([]), cfg)).toEqual([]);
    expect(evaluate(Number.NaN, pos([]), cfg)).toEqual([]);
  });
});
