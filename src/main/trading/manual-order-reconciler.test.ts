import { describe, expect, it } from 'vitest';
import {
  resolveManualOrderDecision,
  resolveServerPendingAbsenceDecision,
} from './manual-order-reconciler';

describe('resolveManualOrderDecision', () => {
  it('총체결수량이 주문수량과 같으면 FILLED로 전이하고 delta를 계산한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 70000,
      remote: {
        odno: '1',
        pdno: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 10,
        remainingQty: 0,
        avgFillPrice: 69900,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'FILLED',
      totalFilledQty: 10,
      deltaFilledQty: 10,
      remainingQty: 0,
      executionPrice: 69900,
    });
  });

  it('이미 일부 체결된 주문은 증가분만 delta로 계산하고 PARTIAL 유지한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PARTIAL',
      orderQty: 10,
      localFilledQty: 2,
      localPrice: 70000,
      remote: {
        odno: '1',
        pdno: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 5,
        remainingQty: 5,
        avgFillPrice: 70100,
        cancelled: false,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'PARTIAL',
      totalFilledQty: 5,
      deltaFilledQty: 3,
      remainingQty: 5,
      executionPrice: 70100,
    });
  });

  it('체결 없이 취소된 주문은 CANCELLED로 전이한다', () => {
    const decision = resolveManualOrderDecision({
      localStatus: 'PENDING',
      orderQty: 10,
      localFilledQty: 0,
      localPrice: 70000,
      remote: {
        odno: '1',
        pdno: '005930',
        name: '삼성전자',
        side: 'BUY',
        orderQty: 10,
        orderPrice: 70000,
        orderedAt: '093000',
        totalFilledQty: 0,
        remainingQty: 10,
        avgFillPrice: 0,
        cancelled: true,
        rejectedQty: 0,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: 10,
      executionPrice: 70000,
    });
  });

  it('서버 미체결 목록에서 사라진 오래된 로컬 PENDING은 CANCELLED로 정리한다', () => {
    const decision = resolveServerPendingAbsenceDecision({
      localFilledQty: 0,
      orderQty: 10,
      localPrice: 70000,
      context: {
        serverPendingPresent: false,
        now: new Date('2026-04-22T09:00:20+09:00'),
        placedAt: new Date('2026-04-22T09:00:00+09:00'),
        graceMs: 10_000,
      },
    });

    expect(decision).toEqual({
      nextStatus: 'CANCELLED',
      totalFilledQty: 0,
      deltaFilledQty: 0,
      remainingQty: 10,
      executionPrice: 70000,
    });
  });

  it('유예 시간 안이면 서버 pending 목록에 아직 없어도 정리하지 않는다', () => {
    const decision = resolveServerPendingAbsenceDecision({
      localFilledQty: 0,
      orderQty: 10,
      localPrice: 70000,
      context: {
        serverPendingPresent: false,
        now: new Date('2026-04-22T09:00:05+09:00'),
        placedAt: new Date('2026-04-22T09:00:00+09:00'),
        graceMs: 10_000,
      },
    });

    expect(decision).toBeNull();
  });
});
