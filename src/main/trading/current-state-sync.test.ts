import { describe, expect, it, vi } from 'vitest';
import { buildLotSyncMismatches, CurrentStateSync } from './current-state-sync';

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
        lotsByPdno: { '005930': [{ qty: 3, status: 'BUYING' }] },
      }),
    ).toEqual([{ pdno: '005930', kisQty: 0, lotQty: 3, reason: 'STALE_LOTS' }]);
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
});
