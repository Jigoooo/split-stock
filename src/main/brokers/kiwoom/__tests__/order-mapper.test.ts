import type { OrderIntent } from '@shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  toKiwoomCancelOrderBody,
  toKiwoomModifyOrderBody,
  toKiwoomPlaceOrderBody,
  toOrderAck,
} from '../mappers/order';

describe('toKiwoomPlaceOrderBody', () => {
  it('LIMIT BUY → trde_tp=0, ord_uv=price', () => {
    const intent: OrderIntent = {
      side: 'BUY',
      symbol: '005930',
      qty: 10,
      price: 70_000,
      kind: 'LIMIT',
    };
    const body = toKiwoomPlaceOrderBody(intent);
    expect(body).toEqual({
      dmst_stex_tp: '1',
      stk_cd: '005930',
      ord_qty: '10',
      trde_tp: '0',
      ord_uv: '70000',
    });
  });

  it('MARKET → trde_tp=3, ord_uv 빈 문자', () => {
    const intent: OrderIntent = {
      side: 'SELL',
      symbol: '005930',
      qty: 5,
      price: 0,
      kind: 'MARKET',
    };
    const body = toKiwoomPlaceOrderBody(intent);
    expect(body.trde_tp).toBe('3');
    expect(body.ord_uv).toBe('');
  });

  it('clientOrderId 는 drop 됨', () => {
    const intent: OrderIntent = {
      side: 'BUY',
      symbol: '005930',
      qty: 1,
      price: 70_000,
      kind: 'LIMIT',
      clientOrderId: 'idem-key',
    };
    const body = toKiwoomPlaceOrderBody(intent);
    expect(body).not.toHaveProperty('clientOrderId');
  });

  it('defaultExchange 옵션으로 dmst_stex_tp 변경 가능 (NXT/SOR)', () => {
    const intent: OrderIntent = {
      side: 'BUY',
      symbol: '005930',
      qty: 1,
      price: 70_000,
      kind: 'LIMIT',
    };
    expect(toKiwoomPlaceOrderBody(intent, '2').dmst_stex_tp).toBe('2');
    expect(toKiwoomPlaceOrderBody(intent, '3').dmst_stex_tp).toBe('3');
  });
});

describe('toKiwoomModifyOrderBody', () => {
  it('orig_ord_no + mdfy_qty + mdfy_uv 매핑', () => {
    const body = toKiwoomModifyOrderBody({
      brokerOrderId: '0001',
      qty: 5,
      price: 71_000,
    });
    expect(body).toEqual({
      dmst_stex_tp: '1',
      orig_ord_no: '0001',
      stk_cd: '',
      mdfy_qty: '5',
      mdfy_uv: '71000',
    });
  });
});

describe('toKiwoomCancelOrderBody', () => {
  it('all=true 면 cncl_qty=0 (전량 취소)', () => {
    const body = toKiwoomCancelOrderBody({ brokerOrderId: '0001', all: true });
    expect(body.cncl_qty).toBe('0');
    expect(body.orig_ord_no).toBe('0001');
  });

  it('qtyAllOrder=true 도 동일 (호환)', () => {
    const body = toKiwoomCancelOrderBody({ brokerOrderId: '0001', qtyAllOrder: true });
    expect(body.cncl_qty).toBe('0');
  });

  it('qty 명시 + all/qtyAllOrder 미지정 → cncl_qty=qty', () => {
    const body = toKiwoomCancelOrderBody({ brokerOrderId: '0001', qty: 7 });
    expect(body.cncl_qty).toBe('7');
  });
});

describe('toOrderAck', () => {
  it('ord_no → brokerOrderId', () => {
    const ack = toOrderAck({ ord_no: 'ABC123', return_code: 0 });
    expect(ack).toEqual({ brokerOrderId: 'ABC123' });
  });

  it('ord_no 누락 시 빈 문자열 (응답 검증 실패 시)', () => {
    const ack = toOrderAck({ return_code: 0 });
    expect(ack.brokerOrderId).toBe('');
  });
});
