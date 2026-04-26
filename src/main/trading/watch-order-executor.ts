import type { AppEnv } from '@shared/contracts';
import { hasActiveCycle } from '@shared/trading/next-nth';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lots, orders } from '../db/schema';
import {
  readPendingCancelConfig,
  readPriceCorrectionConfig,
  type SettingsRepo,
} from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import { orderCash } from '../kis/order';
import { correctLimitPrice } from '@shared/market-rules';
import type { EventLogger } from '../logging/event-logger';
import type { SafetyStateRegistry } from '../safety/safety-state';
import type { CredentialsRepo } from '../security/credentials-repo';
import { assertCredMatchesEnv } from '../trpc/router-helpers';
import type { AutoBuyGuardPort } from './auto-buy-guard';
import type { LotsRepo } from './lots-repo';
import type { AutoOrderMarketGuard } from './market-session-guard';
import { createPendingBuyLot, linkPendingSellLot } from './order-lot-link';
import type { PendingOrderWatcher } from './pending-order-watcher';
import type { StrategyRepo } from './strategy-repo';
import type { WatchOrder } from './watch-engine';

export interface WatchOrderExecutorDeps {
  db: Db;
  settingsRepo: SettingsRepo;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  safetyRegistry: SafetyStateRegistry;
  pendingOrderWatcher: PendingOrderWatcher | null;
  logger: EventLogger;
  getCurrentEnv: () => AppEnv | null;
  lotsRepo: LotsRepo;
  strategyRepo: StrategyRepo;
  marketSessionGuard?: AutoOrderMarketGuard;
  autoBuyGuard?: AutoBuyGuardPort;
}

export interface StrategyOrderInput {
  accountId: number;
  pdno: string;
  side: 'BUY' | 'SELL';
  division: 'LIMIT' | 'MARKET';
  nth: number;
  price: number;
  qty: number;
  triggerReason: 'DROP_BUY' | 'PROFIT_SELL';
}

export async function executeWatchOrder(
  deps: WatchOrderExecutorDeps,
  order: WatchOrder,
  triggerPrice: number,
): Promise<void> {
  const snapshot = deps.lotsRepo.snapshot(order.accountId, order.pdno);
  if (snapshot.isErr()) {
    throw new Error('차수 스냅샷 조회 실패');
  }
  const activeCycleExists = hasActiveCycle(snapshot.value.lots);
  if ((order.source === 'PREBUY' || order.source === 'CUSTOM') && order.side === 'BUY') {
    if (activeCycleExists) {
      throw new Error('이미 활성 차수가 있어 신규 1차 자동진입을 생략합니다.');
    }
  }

  const env = deps.getCurrentEnv();
  if (!env) throw new Error('환경 미선택');

  const credResult = deps.credentialsRepo.loadCredentials(order.accountId);
  if (credResult.isErr() || !credResult.value) {
    throw new Error('자격증명 없음');
  }
  const cred = credResult.value;
  assertCredMatchesEnv(cred, env);

  const safety = deps.safetyRegistry.get(order.accountId);
  if (!safety.canTrade(order.pdno)) {
    throw new Error('안전 스위치에 의해 해당 종목 거래가 차단됨');
  }

  await deps.marketSessionGuard?.assertAutoOrderAllowed({
    accountId: order.accountId,
    pdno: order.pdno,
    side: order.side,
    source: 'WATCH',
  });

  const division = order.orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
  const limitPrice =
    division === 'LIMIT'
      ? correctLimitPrice({
          targetPrice: triggerPrice,
          side: order.side,
          strategy:
            order.side === 'BUY'
              ? readPriceCorrectionConfig(deps.settingsRepo).buy
              : readPriceCorrectionConfig(deps.settingsRepo).sell,
        })
      : 0;
  const qty =
    order.qtyOrAmountMode === 'QTY'
      ? (order.qty ?? 0)
      : Math.floor(
          (order.amountKrw ?? 0) / Math.max(division === 'LIMIT' ? limitPrice : triggerPrice, 1),
        );
  if (qty <= 0) {
    throw new Error('주문 수량이 0주가 되어 주문할 수 없습니다.');
  }
  const estimatedAmountKrw = qty * Math.max(division === 'LIMIT' ? limitPrice : triggerPrice, 1);

  if (order.side === 'BUY') {
    await deps.autoBuyGuard?.assertAutoBuyAllowed({
      accountId: order.accountId,
      amountKrw: estimatedAmountKrw,
      pdno: order.pdno,
      source: 'WATCH',
    });
  }

  const tokenResult = await deps.auth.getValidToken(env, cred.appKey, cred.appSecret);
  if (tokenResult.isErr()) {
    throw new Error(`토큰 발급 실패: ${tokenResult.error.kind}`);
  }

  const result = await orderCash(
    {
      http: deps.httpByEnv[env],
      env,
      token: tokenResult.value.token,
      appKey: cred.appKey,
      appSecret: cred.appSecret,
      accountNo8: cred.accountNo8,
      accountProdCd: cred.accountProdCd,
      logger: deps.logger,
    },
    {
      side: order.side,
      pdno: order.pdno,
      qty,
      price: division === 'LIMIT' ? limitPrice : 0,
      division,
    },
  );
  if (result.isErr()) {
    throw new Error(`주문 실패: ${result.error.kind} - ${result.error.msg}`);
  }
  if ((order.source === 'PREBUY' || order.source === 'CUSTOM') && order.side === 'BUY') {
    const seeded = deps.strategyRepo.ensureSeededActive(order.accountId, order.pdno);
    if (seeded.isErr()) {
      deps.logger.log({
        level: 'ERROR',
        category: 'WATCH',
        message: 'watch.first-entry.seed-failed',
        payload: {
          accountId: order.accountId,
          pdno: order.pdno,
          source: order.source,
          reason: seeded.error.kind,
        },
      });
    } else {
      deps.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'watch.first-entry.seeded',
        payload: {
          accountId: order.accountId,
          pdno: order.pdno,
          source: order.source,
          templateSource: seeded.value.source,
        },
      });
    }
  }

  const now = new Date();
  const linkedLot =
    order.side === 'BUY'
      ? createPendingBuyLot(
          {
            logger: deps.logger,
            lotsRepo: deps.lotsRepo,
          },
          {
            accountId: order.accountId,
            pdno: order.pdno,
            placedAt: now,
            price: division === 'LIMIT' ? limitPrice : 0,
            qty,
            requestedNth: order.nth,
            source: order.source,
          },
        )
      : linkPendingSellLot(
          {
            logger: deps.logger,
            lotsRepo: deps.lotsRepo,
          },
          {
            accountId: order.accountId,
            pdno: order.pdno,
            requestedNth: order.nth,
          },
        );
  deps.db
    .insert(orders)
    .values({
      accountId: order.accountId,
      lotId: linkedLot.lotId,
      odno: result.value.odno,
      orgNo: result.value.orgNo ?? null,
      pdno: order.pdno,
      side: order.side,
      division,
      qty,
      price: division === 'LIMIT' ? limitPrice : 0,
      status: 'PENDING',
      placedAt: now,
    })
    .run();

  deps.logger.log({
    level: 'INFO',
    category: 'WATCH',
    message: 'watch.order-submitted',
    payload: {
      accountId: order.accountId,
      pdno: order.pdno,
      side: order.side,
      source: order.source,
      nth: linkedLot.nth ?? order.nth ?? null,
      qty,
      triggerPrice,
    },
  });

  const pendingCfg = readPendingCancelConfig(deps.settingsRepo);
  if (
    pendingCfg.enabled &&
    division === 'LIMIT' &&
    result.value.orgNo &&
    deps.pendingOrderWatcher
  ) {
    deps.pendingOrderWatcher.register({
      pdno: order.pdno,
      side: order.side,
      nth: linkedLot.nth ?? order.nth ?? Date.now() % 1_000_000,
      odno: result.value.odno,
      orgNo: result.value.orgNo,
      qty,
      accountId: order.accountId,
    });
  }
}

export async function executeStrategyOrder(
  deps: WatchOrderExecutorDeps,
  input: StrategyOrderInput,
): Promise<void> {
  const env = deps.getCurrentEnv();
  if (!env) throw new Error('환경 미선택');

  const credResult = deps.credentialsRepo.loadCredentials(input.accountId);
  if (credResult.isErr() || !credResult.value) {
    throw new Error('자격증명 없음');
  }
  const cred = credResult.value;
  assertCredMatchesEnv(cred, env);

  const safety = deps.safetyRegistry.get(input.accountId);
  if (!safety.canTrade(input.pdno)) {
    throw new Error('안전 스위치에 의해 해당 종목 거래가 차단됨');
  }

  if (input.side === 'BUY') {
    await deps.autoBuyGuard?.assertAutoBuyAllowed({
      accountId: input.accountId,
      amountKrw: input.qty * Math.max(input.price, 1),
      pdno: input.pdno,
      source: 'STRATEGY',
    });
  }

  const tokenResult = await deps.auth.getValidToken(env, cred.appKey, cred.appSecret);
  if (tokenResult.isErr()) {
    throw new Error(`토큰 발급 실패: ${tokenResult.error.kind}`);
  }

  const result = await orderCash(
    {
      http: deps.httpByEnv[env],
      env,
      token: tokenResult.value.token,
      appKey: cred.appKey,
      appSecret: cred.appSecret,
      accountNo8: cred.accountNo8,
      accountProdCd: cred.accountProdCd,
      logger: deps.logger,
    },
    {
      side: input.side,
      pdno: input.pdno,
      qty: input.qty,
      price: input.division === 'LIMIT' ? input.price : 0,
      division: input.division,
    },
  );
  if (result.isErr()) {
    throw new Error(`주문 실패: ${result.error.kind} - ${result.error.msg}`);
  }

  const now = new Date();
  const linkedLot =
    input.side === 'BUY'
      ? createPendingBuyLot(
          {
            logger: deps.logger,
            lotsRepo: deps.lotsRepo,
          },
          {
            accountId: input.accountId,
            pdno: input.pdno,
            placedAt: now,
            price: input.division === 'LIMIT' ? input.price : 0,
            qty: input.qty,
            requestedNth: input.nth,
            source: 'STRATEGY',
          },
        )
      : linkPendingSellLot(
          {
            logger: deps.logger,
            lotsRepo: deps.lotsRepo,
          },
          {
            accountId: input.accountId,
            pdno: input.pdno,
            requestedNth: input.nth,
          },
        );

  deps.db
    .insert(orders)
    .values({
      accountId: input.accountId,
      lotId: linkedLot.lotId,
      odno: result.value.odno,
      orgNo: result.value.orgNo ?? null,
      pdno: input.pdno,
      side: input.side,
      division: input.division,
      qty: input.qty,
      price: input.division === 'LIMIT' ? input.price : 0,
      status: 'PENDING',
      placedAt: now,
    })
    .run();

  const pendingCfg = readPendingCancelConfig(deps.settingsRepo);
  if (
    pendingCfg.enabled &&
    input.division === 'LIMIT' &&
    result.value.orgNo &&
    deps.pendingOrderWatcher
  ) {
    deps.pendingOrderWatcher.register({
      pdno: input.pdno,
      side: input.side,
      nth: linkedLot.nth ?? input.nth,
      odno: result.value.odno,
      orgNo: result.value.orgNo,
      qty: input.qty,
      accountId: input.accountId,
    });
  }

  deps.logger.log({
    level: 'INFO',
    category: 'FSM',
    message: 'strategy.order-submitted',
    payload: {
      accountId: input.accountId,
      pdno: input.pdno,
      side: input.side,
      nth: linkedLot.nth ?? input.nth,
      triggerReason: input.triggerReason,
      qty: input.qty,
      price: input.price,
    },
  });
}

export function cancelPendingByOdno(
  db: Db,
  pendingOrderWatcher: PendingOrderWatcher | null,
  accountId: number,
  odno: string,
): void {
  const row = db
    .select()
    .from(orders)
    .where(and(eq(orders.odno, odno), eq(orders.accountId, accountId)))
    .get();
  db.update(orders)
    .set({ status: 'CANCELLED' })
    .where(and(eq(orders.odno, odno), eq(orders.accountId, accountId)))
    .run();
  if (row?.lotId !== null && row?.lotId !== undefined) {
    if (row.side === 'BUY') {
      db.delete(lots).where(eq(lots.id, row.lotId)).run();
    } else if (row.side === 'SELL') {
      db.update(lots)
        .set({ status: 'OPEN', soldAt: null, sellPrice: null })
        .where(eq(lots.id, row.lotId))
        .run();
    }
  }
  if (!pendingOrderWatcher) return;
  const active = pendingOrderWatcher.listActive();
  for (const entry of active) {
    if (entry.odno !== odno) continue;
    pendingOrderWatcher.cancel({
      pdno: entry.pdno,
      side: entry.side,
      nth: entry.nth,
    });
  }
}
