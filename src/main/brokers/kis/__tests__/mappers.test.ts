import type {
  BalanceResult,
  DailyCandle,
  DailyCcldOrder,
  OrderbookSnapshot as KisOrderbookSnapshot,
  Position,
  QuoteResult,
} from '@main/kis/domestic-stock';
import type { NormalizedOrderAck, OrderIntent } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import { toBalance, toHolding } from '../mappers/balance';
import { toCandle } from '../mappers/candle';
import { toDailyExecution } from '../mappers/executions';
import {
  toKisAmendParams,
  toKisCancelParams,
  toKisOrderCashParams,
  toOrderAck,
} from '../mappers/order';
import { toOrderbookSnapshot } from '../mappers/orderbook';
import { toQuote } from '../mappers/quote';

describe('balance mapper', () => {
  it('Position → Holding (code → symbol)', () => {
    const p: Position = {
      code: '005930',
      name: '삼성전자',
      qty: 10,
      avgPrice: 70_000,
      currentPrice: 71_000,
      evalAmount: 710_000,
      pnlAmount: 10_000,
      pnlRate: 1.43,
    };
    const h = toHolding(p);
    expect(h.symbol).toBe('005930');
    expect(h.name).toBe('삼성전자');
    expect(h.qty).toBe(10);
    expect(h.avgPrice).toBe(70_000);
    expect(h.pnlRate).toBe(1.43);
  });

  it('BalanceResult → Balance', () => {
    const b: BalanceResult = {
      positions: [
        {
          code: '005930',
          name: '삼성전자',
          qty: 1,
          avgPrice: 70_000,
          currentPrice: 71_000,
          evalAmount: 71_000,
          pnlAmount: 1_000,
          pnlRate: 1.43,
        },
      ],
      deposit: 1_000_000,
      d2Deposit: 950_000,
      totalEval: 1_071_000,
      estimatedAsset: 1_071_000,
    };
    const r = toBalance(b);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]?.symbol).toBe('005930');
    expect(r.deposit).toBe(1_000_000);
    expect(r.estimatedAsset).toBe(1_071_000);
  });
});

describe('order mapper', () => {
  it('OrderIntent → KIS OrderCashParams (symbol → pdno, kind → division)', () => {
    const intent: OrderIntent = {
      side: 'BUY',
      symbol: '005930',
      qty: 10,
      price: 70_000,
      kind: 'LIMIT',
    };
    const k = toKisOrderCashParams(intent);
    expect(k.side).toBe('BUY');
    expect(k.pdno).toBe('005930');
    expect(k.qty).toBe(10);
    expect(k.price).toBe(70_000);
    expect(k.division).toBe('LIMIT');
  });

  it('OrderIntent.clientOrderId 는 KIS 매핑에서 drop', () => {
    const intent: OrderIntent = {
      side: 'SELL',
      symbol: '005930',
      qty: 5,
      price: 0,
      kind: 'MARKET',
      clientOrderId: 'idempotency-key',
    };
    const k = toKisOrderCashParams(intent);
    expect(k).not.toHaveProperty('clientOrderId');
    expect(k.division).toBe('MARKET');
  });

  it('OrderAmendIntent → KIS revise params (kind 기본 LIMIT, all=false)', () => {
    const k = toKisAmendParams(
      {
        brokerOrderId: '0001',
        brokerOrgNo: '00001',
        qty: 5,
        price: 71_000,
      },
      'revise',
    );
    expect(k.action).toBe('revise');
    expect(k.orgOdno).toBe('0001');
    expect(k.orgOrgNo).toBe('00001');
    expect(k.qty).toBe(5);
    expect(k.price).toBe(71_000);
    expect(k.division).toBe('LIMIT');
    expect(k.qtyAllOrder).toBe(false);
  });

  it('CancelOrderInput.all=true → qtyAllOrder=true', () => {
    const k = toKisCancelParams({ brokerOrderId: '0001', all: true });
    expect(k.action).toBe('cancel');
    expect(k.qtyAllOrder).toBe(true);
  });

  it('NormalizedOrderAck → OrderAck (odno → brokerOrderId)', () => {
    const ack: NormalizedOrderAck = {
      odno: '0009',
      orgNo: '00099',
      orderedAt: '093015',
    };
    const d = toOrderAck(ack);
    expect(d.brokerOrderId).toBe('0009');
    expect(d.brokerOrgNo).toBe('00099');
    expect(d.acceptedAt).toBe('093015');
  });

  it('NormalizedOrderAck — orgNo/orderedAt 누락 시 키 자체 생략', () => {
    const ack: NormalizedOrderAck = { odno: '0010' };
    const d = toOrderAck(ack);
    expect(d.brokerOrderId).toBe('0010');
    expect(d).not.toHaveProperty('brokerOrgNo');
    expect(d).not.toHaveProperty('acceptedAt');
  });
});

describe('quote mapper', () => {
  it('QuoteResult → Quote (code → symbol)', () => {
    const q: QuoteResult = {
      code: '005930',
      price: 71_000,
      dayChange: 1_000,
      dayChangeRate: 1.43,
      accumVolume: 1_234_567,
      open: 70_500,
      high: 71_500,
      low: 70_200,
      upperLimit: 91_000,
      lowerLimit: 49_000,
      prevClose: 70_000,
    };
    const r = toQuote(q);
    expect(r.symbol).toBe('005930');
    expect(r.price).toBe(71_000);
    expect(r.dayChangeRate).toBe(1.43);
  });
});

describe('orderbook mapper', () => {
  it('KIS OrderbookSnapshot → 도메인 OrderbookSnapshot (quantity → qty, pdno → symbol)', () => {
    const o: KisOrderbookSnapshot = {
      pdno: '005930',
      time: '093015',
      asks: [{ price: 71_100, quantity: 100 }],
      bids: [{ price: 71_000, quantity: 200 }],
      totalAskQty: 100,
      totalBidQty: 200,
      expectedPrice: 71_050,
      expectedQty: 0,
    };
    const r = toOrderbookSnapshot(o);
    expect(r.symbol).toBe('005930');
    expect(r.asks[0]).toEqual({ price: 71_100, qty: 100 });
    expect(r.bids[0]).toEqual({ price: 71_000, qty: 200 });
    expect(r.expectedPrice).toBe(71_050);
  });
});

describe('candle mapper', () => {
  it('DailyCandle → Candle (date 형식 그대로 유지)', () => {
    const c: DailyCandle = {
      date: '2024-12-30',
      open: 70_000,
      high: 71_000,
      low: 69_500,
      close: 70_500,
      volume: 5_000_000,
    };
    const r = toCandle(c);
    expect(r).toEqual(c);
  });
});

describe('executions mapper', () => {
  it('DailyCcldOrder → DailyExecution (odno → brokerOrderId, pdno → symbol)', () => {
    const o: DailyCcldOrder = {
      odno: '0001',
      pdno: '005930',
      name: '삼성전자',
      side: 'BUY',
      orderQty: 10,
      orderPrice: 70_000,
      orderedAt: '093015',
      totalFilledQty: 5,
      remainingQty: 5,
      avgFillPrice: 70_000,
      cancelled: false,
      rejectedQty: 0,
    };
    const r = toDailyExecution(o);
    expect(r.brokerOrderId).toBe('0001');
    expect(r.symbol).toBe('005930');
    expect(r.totalFilledQty).toBe(5);
    expect(r.remainingQty).toBe(5);
    expect(r.cancelled).toBe(false);
  });
});
