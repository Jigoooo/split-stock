import { describe, expect, it } from 'vitest';
import { KisRealtimeAdapter, mapKisCniNoticeToAccountEvent } from './realtime-adapter';

describe('mapKisCniNoticeToAccountEvent', () => {
  it('체결 완료 CNI 레코드를 ORDER_DIRTY + execution으로 변환한다', () => {
    const event = mapKisCniNoticeToAccountEvent({
      tr: 'H0STCNI9',
      htsId: 'HTS123',
      seq: 1,
      raw: '0^1^ORD-1^x^x^x^x^x^A005930^3^70100^093001^x^2',
    });

    expect(event).toEqual({
      kind: 'ORDER_DIRTY',
      brokerOrderId: 'ORD-1',
      symbol: '005930',
      execution: {
        brokerOrderId: 'ORD-1',
        symbol: '005930',
        filledQty: 3,
        price: 70100,
        at: '093001',
      },
      at: '093001',
    });
  });

  it('미체결/접수 CNI 레코드는 주문 dirty signal만 발생시킨다', () => {
    const event = mapKisCniNoticeToAccountEvent({
      tr: 'H0STCNI9',
      htsId: 'HTS123',
      seq: 1,
      raw: '0^1^ORD-1^x^x^x^x^x^A005930^0^0^093001^x^1',
    });

    expect(event).toEqual({
      kind: 'ORDER_DIRTY',
      brokerOrderId: 'ORD-1',
      symbol: '005930',
      at: '093001',
    });
  });

  it('CNI 원시 구독 실패를 RealtimePort 에러로 전파한다', () => {
    const adapter = new KisRealtimeAdapter({
      getService: () =>
        ({
          subscribeCniNotices: () => ({ ok: false, reason: 'capacity exceeded' }),
        }) as never,
      bus: {} as never,
      getHtsId: () => 'HTS123',
    });

    const result = adapter.subscribeAccountEvents(() => undefined);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('VALIDATION');
      expect(result.error.msg).toBe('capacity exceeded');
    }
  });
});
