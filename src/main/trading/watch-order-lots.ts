import { eq } from 'drizzle-orm';
import { lots } from '../db/schema';
import { createPendingBuyLot, linkPendingSellLot } from './order-lot-link';
import type { WatchOrder } from './watch-engine';
import type {
  AutoOrderLocalSource,
  PreparedOrderLot,
  StrategyOrderInput,
  WatchOrderExecutorDeps,
} from './watch-order-types';

export function prepareWatchOrderLot(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
  input: {
    division: 'LIMIT' | 'MARKET';
    limitPrice: number;
    now: Date;
    qty: number;
  },
): PreparedOrderLot {
  if (order.side === 'BUY') {
    return createRequiredPendingBuyLot(deps, {
      accountId: order.accountId,
      pdno: order.pdno,
      placedAt: input.now,
      price: input.division === 'LIMIT' ? input.limitPrice : 0,
      qty: input.qty,
      requestedNth: order.nth,
      source: order.source,
    });
  }
  return linkRequiredPendingSellLot(deps, {
    accountId: order.accountId,
    pdno: order.pdno,
    requestedNth: order.nth,
  });
}

export function prepareStrategyOrderLot(
  deps: WatchOrderExecutorDeps,
  input: StrategyOrderInput,
  now: Date,
): PreparedOrderLot {
  if (input.side === 'BUY') {
    return createRequiredPendingBuyLot(deps, {
      accountId: input.accountId,
      pdno: input.pdno,
      placedAt: now,
      price: input.division === 'LIMIT' ? input.price : 0,
      qty: input.qty,
      requestedNth: input.nth,
      source: 'STRATEGY',
    });
  }
  return linkRequiredPendingSellLot(deps, {
    accountId: input.accountId,
    pdno: input.pdno,
    requestedNth: input.nth,
  });
}

function createRequiredPendingBuyLot(
  deps: WatchOrderExecutorDeps,
  input: {
    accountId: number;
    pdno: string;
    placedAt: Date;
    price: number;
    qty: number;
    requestedNth: number | null;
    source: AutoOrderLocalSource;
  },
): PreparedOrderLot {
  const linked = createPendingBuyLot(
    {
      logger: deps.logger,
      lotsRepo: deps.lotsRepo,
    },
    input,
  );
  if (linked.lotId === null) {
    throw new Error('자동매수 차수 예약 실패: 로컬 BUYING 차수를 생성하지 못했습니다.');
  }
  return { lotId: linked.lotId, nth: linked.nth, side: 'BUY' };
}

function linkRequiredPendingSellLot(
  deps: WatchOrderExecutorDeps,
  input: {
    accountId: number;
    pdno: string;
    requestedNth: number | null;
  },
): PreparedOrderLot {
  const linked = linkPendingSellLot(
    {
      logger: deps.logger,
      lotsRepo: deps.lotsRepo,
    },
    input,
  );
  if (linked.lotId === null) {
    throw new Error(
      '자동매도 차수 예약 실패: 매도 가능한 OPEN 차수를 SELLING으로 전환하지 못했습니다.',
    );
  }
  return { lotId: linked.lotId, nth: linked.nth, side: 'SELL' };
}

export function rollbackPreparedOrderLot(
  deps: WatchOrderExecutorDeps,
  linkedLot: PreparedOrderLot,
): void {
  try {
    // Phase 6: lots.id 는 PK — broker 필터 불필요. 도메스틱(KIS/KIWOOM) 모두 처리.
    if (linkedLot.side === 'BUY') {
      deps.db.delete(lots).where(eq(lots.id, linkedLot.lotId)).run();
      return;
    }
    deps.db
      .update(lots)
      .set({ status: 'OPEN', soldAt: null, sellPrice: null })
      .where(eq(lots.id, linkedLot.lotId))
      .run();
  } catch (cause) {
    deps.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'order.local-reservation.rollback-failed',
      payload: {
        lotId: linkedLot.lotId,
        reason: cause instanceof Error ? cause.message : String(cause),
        side: linkedLot.side,
      },
    });
  }
}
