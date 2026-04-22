import type { EventLogger } from '../logging/event-logger';
import type { BalanceSync } from './balance-sync';
import type { ManualOrderReconciler } from './manual-order-reconciler';

export type LotSyncStatus = 'IN_SYNC' | 'MISMATCH';

export interface LotSyncMismatch {
  pdno: string;
  kisQty: number;
  lotQty: number;
  reason: 'NO_LOTS' | 'STALE_LOTS' | 'QTY_MISMATCH';
}

export interface CurrentStateSyncOptions {
  balanceSync: Pick<BalanceSync, 'refresh'>;
  logger: EventLogger;
  manualOrderReconciler: Pick<ManualOrderReconciler, 'poll'>;
}

export function buildLotSyncMismatches(input: {
  lotsByPdno: Record<string, Array<{ qty: number; status: string }>>;
  positions: Array<{ code: string; qty: number }>;
}): LotSyncMismatch[] {
  const kisQtyByPdno = new Map<string, number>();
  for (const position of input.positions) {
    if (position.qty <= 0) continue;
    kisQtyByPdno.set(position.code, position.qty);
  }

  const lotQtyByPdno = new Map<string, number>();
  for (const [pdno, lots] of Object.entries(input.lotsByPdno)) {
    const qty = lots.reduce((sum, lot) => sum + lot.qty, 0);
    if (qty > 0) lotQtyByPdno.set(pdno, qty);
  }

  const pdnos = new Set([...kisQtyByPdno.keys(), ...lotQtyByPdno.keys()]);
  const mismatches: LotSyncMismatch[] = [];
  for (const pdno of pdnos) {
    const kisQty = kisQtyByPdno.get(pdno) ?? 0;
    const lotQty = lotQtyByPdno.get(pdno) ?? 0;
    if (kisQty === lotQty) continue;
    mismatches.push({
      pdno,
      kisQty,
      lotQty,
      reason: kisQty > 0 && lotQty === 0 ? 'NO_LOTS' : kisQty === 0 ? 'STALE_LOTS' : 'QTY_MISMATCH',
    });
  }
  return mismatches.sort((a, b) => a.pdno.localeCompare(b.pdno));
}

/**
 * 현 상태 수렴 트리거.
 * - 주문/체결 상태를 먼저 보정
 * - 그 다음 잔고 pull로 broker 기준 괴리를 감지/보강
 */
export class CurrentStateSync {
  private running = false;

  constructor(private readonly opts: CurrentStateSyncOptions) {}

  async refresh(
    reason: 'startup' | 'account-switch' | 'env-switch' | 'trade-event',
  ): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.opts.manualOrderReconciler.poll();
      await this.opts.balanceSync.refresh();
      this.opts.logger.log({
        level: 'INFO',
        category: 'BALANCE',
        message: 'current-state-sync.refreshed',
        payload: { reason },
      });
    } finally {
      this.running = false;
    }
  }
}
