import { describe, expect, it, vi } from 'vitest';
import { FakeTimer } from '../testing/fake-timer';
import { buildLotSyncMismatches, buildLotSyncState, CurrentStateSync } from './current-state-sync';

describe('buildLotSyncMismatches', () => {
  it('동일 수량이면 mismatch가 없다', () => {
    expect(
      buildLotSyncMismatches({
        positions: [{ code: '005930', qty: 10 }],
        lotsByPdno: { '005930': [{ qty: 10, status: 'OPEN' }] },
      }),
    ).toEqual([]);
  });

  it('KIS에 있는데 lots가 없으면 NO_LOTS로 표시한다', () => {
    expect(
      buildLotSyncMismatches({
        positions: [{ code: '005930', qty: 10 }],
        lotsByPdno: {},
      }),
    ).toEqual([{ pdno: '005930', kisQty: 10, lotQty: 0, reason: 'NO_LOTS' }]);
  });

  it('lots만 남아 있으면 STALE_LOTS로 표시한다', () => {
    expect(
      buildLotSyncMismatches({
        positions: [],
        lotsByPdno: { '005930': [{ qty: 3, status: 'OPEN' }] },
      }),
    ).toEqual([{ pdno: '005930', kisQty: 0, lotQty: 3, reason: 'STALE_LOTS' }]);
  });

  it('BUYING 차수만 있는 종목은 mismatch 에서 완전 제외된다 (KIS lag 흡수)', () => {
    // 미체결 매수 즉시 BUYING 차수가 insert 되지만 KIS 잔고는 fill 까지 0 이라
    // STALE_LOTS 로 오인되면 사용자에게 잘못된 경고. BUYING 은 lot 합산에서 제외.
    expect(
      buildLotSyncMismatches({
        positions: [],
        lotsByPdno: { '005930': [{ qty: 3, status: 'BUYING' }] },
      }),
    ).toEqual([]);
  });

  it('OPEN + BUYING 혼합이면 OPEN 만 합산해 mismatch 비교한다', () => {
    expect(
      buildLotSyncMismatches({
        positions: [{ code: '005930', qty: 5 }],
        lotsByPdno: {
          '005930': [
            { qty: 5, status: 'OPEN' },
            { qty: 3, status: 'BUYING' },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('SELLING 차수의 일시 수량 차이는 RECONCILING으로 분리한다', () => {
    expect(
      buildLotSyncState({
        positions: [],
        lotsByPdno: { '005930': [{ qty: 3, status: 'SELLING' }] },
      }),
    ).toEqual({
      syncStatus: 'RECONCILING',
      mismatches: [],
      pendingMismatches: [{ pdno: '005930', kisQty: 0, lotQty: 3, reason: 'STALE_LOTS' }],
    });
  });

  it('최근 매도 주문 종목의 차이는 grace window 동안 RECONCILING으로 표시한다', () => {
    expect(
      buildLotSyncState({
        positions: [{ code: '005930', qty: 1 }],
        lotsByPdno: { '005930': [{ qty: 3, status: 'OPEN' }] },
        recentSellOrderPdnos: new Set(['005930']),
      }),
    ).toMatchObject({
      syncStatus: 'RECONCILING',
      mismatches: [],
      pendingMismatches: [{ pdno: '005930', kisQty: 1, lotQty: 3, reason: 'QTY_MISMATCH' }],
    });
  });
});

describe('CurrentStateSync', () => {
  it('trigger는 이미 실행 중이면 다시 시작하지 않는다', async () => {
    let release = () => {};
    const sync = new CurrentStateSync({
      manualOrderReconciler: {
        poll: async () =>
          await new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
      balanceSync: {
        refresh: async () => undefined,
      },
      logger: { log: vi.fn() } as never,
    });

    expect(sync.trigger('manual')).toEqual({ started: true });
    expect(sync.trigger('manual')).toEqual({ started: false });

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('refresh는 reconciler 후 balance sync를 순차 실행한다', async () => {
    const callOrder: string[] = [];
    const sync = new CurrentStateSync({
      manualOrderReconciler: {
        poll: async () => {
          callOrder.push('reconciler');
        },
      },
      balanceSync: {
        refresh: async () => {
          callOrder.push('balance');
        },
      },
      logger: { log: vi.fn() } as never,
    });

    await sync.refresh('startup');

    expect(callOrder).toEqual(['reconciler', 'balance']);
  });

  it('broker 이벤트를 debounce 한 뒤 대상 주문부터 reconciler에 전달한다', async () => {
    const timer = new FakeTimer();
    const pollTargets: unknown[] = [];
    const callOrder: string[] = [];
    const sync = new CurrentStateSync({
      manualOrderReconciler: {
        poll: async (target) => {
          pollTargets.push(target);
          callOrder.push('reconciler');
        },
      },
      balanceSync: {
        refresh: async () => {
          callOrder.push('balance');
        },
      },
      logger: { log: vi.fn() } as never,
      timer,
      brokerEventDebounceMs: 100,
    });

    expect(sync.enqueueBrokerEvent({ accountId: 1, brokerOrderId: 'A', symbol: '005930' })).toEqual(
      { queued: true },
    );
    expect(sync.enqueueBrokerEvent({ accountId: 1, brokerOrderId: 'B', symbol: '005930' })).toEqual(
      { queued: true },
    );

    timer.advance(99);
    await Promise.resolve();
    expect(callOrder).toEqual([]);

    timer.advance(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(pollTargets).toEqual([{ accountId: 1, symbol: '005930' }]);
    expect(callOrder).toEqual(['reconciler', 'balance']);
  });
});
