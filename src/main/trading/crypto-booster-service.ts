import type {
  CryptoExchangeError,
  CryptoKrwMarketCode,
  CryptoOrderIntent,
  CryptoPrivateOrderEvent,
  CryptoStrategyProfile,
} from '@shared/contracts';
import { CryptoKrwMarketCodeSchema } from '@shared/contracts';
import type { Result } from 'neverthrow';
import type { CryptoAutoTradingRepo } from '../crypto/crypto-auto-repo';
import type { Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';
import type { CryptoAutoBuyGuardPort } from '../safety/crypto-auto-buy-guard';
import { type BoosterTask, type BoosterTriggerContext, BoosterWatcher } from './booster-watcher';

/**
 * E2-1 코인 부스터 — UPBIT 1차 전량 매도 후 lastFilledPrice * (1 - boosterPct) 도달 시
 * 1차 재매수를 트리거. 도메스틱 BoosterService 와 평행한 별도 클래스.
 *
 * **architectural 결정 (옵션 2)**: TradeExecutionEvent (KIS, 6자리 pdno, integer price)
 * vs CryptoPrivateOrderEvent (UPBIT, KRW-XXX market, DecimalString price/volume) 스키마가
 * 강하게 달라 union 강제는 도메인 의미를 깨뜨린다. ProtectionGuard ↔ CryptoProtectionGuard
 * 가 이미 별도이므로 동일한 패턴을 booster 에도 적용.
 *
 * **BoosterWatcher 재사용**: BoosterTask 가 (accountId, pdno: string) 만 사용하므로
 * broker-agnostic. 코인 market code (KRW-BTC) 를 pdno 자리에 그대로 사용.
 *
 * **placement 경로**: CryptoAutoTradingService.runLiveTick 의 plan() 은 entryCondition
 * (price-above/below) 검증을 하므로 booster 의 자체 임계값 로직과 충돌. 따라서 직접
 * adapter.createOrder 호출 + 수동 gate (safetyRegistry / protectionGuard / rateGuard)
 * 컴포지션. 도메스틱 executeStrategyOrder 의 패턴 미러링.
 */

export interface CryptoBoosterFillEvent {
  exchange: 'UPBIT';
  accountId: number;
  market: CryptoKrwMarketCode;
}

export interface CryptoBoosterAdapter {
  createOrder(intent: CryptoOrderIntent): Promise<Result<unknown, CryptoExchangeError>>;
}

export interface CryptoBoosterServiceDeps {
  timer: Timer;
  /** crypto realtime bus — ticker price feed 구독. */
  bus: {
    subscribeTicker(market: string, listener: (ticker: { tradePrice: string }) => void): () => void;
  };
  /** lots / strategy / event log 통합 repo. */
  repo: Pick<
    CryptoAutoTradingRepo,
    'listOpenLots' | 'getStrategy' | 'insertEvent' | 'markLiveAction'
  >;
  /** UPBIT BUY placement 어댑터 — 부스터 트리거 시점에 lazy 로 주입. null 이면 skip. */
  getAdapter: (accountId: number) => CryptoBoosterAdapter | null;
  /** WS ticker subscription refcount — env 전환 시 service 재생성 가능하므로 callback. */
  getRealtime: () => {
    watchMarket(input: { market: string; candleUnit: '1m' }): void;
    unwatchMarket(input: { market: string; candleUnit: '1m' }): void;
  } | null;
  /** 글로벌 자동매매 잠금. broker-agnostic. */
  safetyRegistry: {
    get(accountId: number): {
      canTrade(symbol: string): boolean;
      getSnapshot(): { master: boolean; errorLock: { active: boolean; reason?: string | null } };
    };
  };
  /** 일/계좌 한도 + RateGuard per-symbol SELL_ONLY 전환. (E2-2) */
  cryptoAutoBuyGuard: CryptoAutoBuyGuardPort;
  /** 연속매수 방지. 매수 성공 직후 recordBuy. */
  rateGuard: {
    recordBuy(accountId: number, symbol: string, ts: number): void;
    checkAndPossiblyDisableAuto(accountId: number): { switchedToManual: boolean };
  };
  logger: EventLogger;
  now?: () => number;
}

export class CryptoBoosterService {
  private readonly watcher: BoosterWatcher;
  private readonly busUnsubs = new Map<string, () => void>();
  /** Bd4: 첫 실패 후 5 초 재시도를 예약한 task key 집합. 2차 실패면 cleanup. */
  private readonly retriedTasks = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: CryptoBoosterServiceDeps) {
    this.now = deps.now ?? (() => deps.timer.now());
    this.watcher = new BoosterWatcher({
      timer: deps.timer,
      onTrigger: (task, ctx) => {
        void this.onTrigger(task, ctx);
      },
      onExpire: (task) => this.onExpire(task),
    });
  }

  /**
   * crypto-realtime-service.applyPrivateOrder → bus.publishPrivateOrder 직후 호출.
   *
   * 1차 전량 매도 감지 조건 (cycle-closing):
   * - side === 'ask' (매도)
   * - state === 'done' (체결 완료)
   * - remainingVolume === '0' (전량 체결)
   * - post-fill listOpenLots 가 비어있음 (active cycle 0)
   * - sequence === 1 검사: open lots 가 0이라는 것은 직전에 1차 lot 이 닫혔다는 뜻이므로
   *   별도 nth 검사 불필요 (도메스틱 nth=1 검사를 listOpenLots 후행 검사로 대체).
   */
  handleCryptoFill(event: CryptoPrivateOrderEvent): void {
    if (event.side !== 'ask') return;
    if (event.state !== 'done') return;
    if (event.remainingVolume !== '0') return;

    const market = CryptoKrwMarketCodeSchema.safeParse(event.market);
    if (!market.success) return;

    const lots = this.deps.repo.listOpenLots(event.accountId, market.data, 'live');
    if (lots.length > 0) return; // active cycle 존재

    const strategy = this.deps.repo.getStrategy(event.accountId, market.data);
    if (!strategy.profitBooster?.enabled) return;

    const firstBuyAmount = strategy.buyRules[0]?.amountKrw;
    if (firstBuyAmount === undefined || Number(firstBuyAmount) <= 0) return;

    const lastFilledPrice = computeLastFilledPrice(event);
    if (lastFilledPrice === null) return;

    const boosterPct = Number(strategy.profitBooster.dropPct);
    if (!Number.isFinite(boosterPct)) return;

    const expiresAt = strategy.profitBooster.expiresAt;
    const task: BoosterTask = {
      accountId: event.accountId,
      pdno: market.data,
      lastFilledPrice,
      boosterPct,
      amountKrw: Number(firstBuyAmount),
      ...(expiresAt !== null && expiresAt !== undefined ? { expiresAt } : {}),
    };

    this.register(task);
    this.deps.logger.log({
      level: 'INFO',
      category: 'WATCH',
      message: 'crypto-booster.registered',
      payload: {
        accountId: task.accountId,
        market: task.pdno,
        lastFilledPrice: task.lastFilledPrice,
        boosterPct: task.boosterPct,
        amountKrw: task.amountKrw,
      },
    });
  }

  register(task: BoosterTask): void {
    const key = entryKey(task.accountId, task.pdno);
    const realtime = this.deps.getRealtime();
    realtime?.watchMarket({ market: task.pdno, candleUnit: '1m' });

    const prev = this.busUnsubs.get(key);
    if (prev) prev();
    const unsub = this.deps.bus.subscribeTicker(task.pdno, (ticker) => {
      const price = Number(ticker.tradePrice);
      if (!Number.isFinite(price) || price <= 0) return;
      this.watcher.onPrice(task.accountId, task.pdno, price);
    });
    this.busUnsubs.set(key, unsub);

    this.watcher.register(task);
  }

  cancel(accountId: number, market: string): void {
    this.watcher.cancel(accountId, market);
    this.cleanupSubscription(accountId, market);
  }

  has(accountId: number, market: string): boolean {
    return this.watcher.has(accountId, market);
  }

  list(): readonly BoosterTask[] {
    return this.watcher.list();
  }

  size(): number {
    return this.watcher.size();
  }

  dispose(): void {
    for (const task of this.watcher.list()) {
      this.cleanupSubscription(task.accountId, task.pdno);
    }
    this.watcher.dispose();
  }

  /**
   * 트리거 콜백.
   * idempotency: 사용자가 수동 1차 매수했을 수 있으므로 listOpenLots 재확인.
   * enabled 토글 재확인. safetyRegistry / protectionGuard / rateGuard 게이트 통과 시
   * adapter.createOrder 직접 호출.
   */
  private async onTrigger(task: BoosterTask, ctx: BoosterTriggerContext): Promise<void> {
    const market = CryptoKrwMarketCodeSchema.safeParse(task.pdno);
    if (!market.success) {
      this.cleanupSubscription(task.accountId, task.pdno);
      return;
    }
    try {
      const lots = this.deps.repo.listOpenLots(task.accountId, market.data, 'live');
      if (lots.length > 0) {
        this.logTriggerSkipped(task, 'active-cycle-exists');
        return;
      }

      const strategy = this.deps.repo.getStrategy(task.accountId, market.data);
      if (!strategy.profitBooster?.enabled) {
        this.logTriggerSkipped(task, 'booster-disabled');
        return;
      }

      const snap = this.deps.safetyRegistry.get(task.accountId).getSnapshot();
      if (!snap.master) {
        this.logTriggerSkipped(task, 'safety-master-off');
        return;
      }
      if (snap.errorLock.active) {
        this.logTriggerSkipped(task, 'safety-error-lock', { reason: snap.errorLock.reason });
        return;
      }

      try {
        this.deps.cryptoAutoBuyGuard.assertAutoBuyAllowed({
          accountId: task.accountId,
          market: market.data,
          amountKrw: task.amountKrw,
          source: 'BOOSTER',
        });
      } catch (e) {
        this.logTriggerSkipped(task, 'auto-buy-guard', {
          reason: e instanceof Error ? e.message : String(e),
        });
        return;
      }

      const adapter = this.deps.getAdapter(task.accountId);
      if (!adapter) {
        this.logTriggerSkipped(task, 'adapter-unavailable');
        return;
      }

      const intent = buildBoosterBuyIntent(task, market.data, strategy);
      const placed = await adapter.createOrder(intent);
      if (placed.isErr()) {
        this.deps.logger.log({
          level: 'ERROR',
          category: 'WATCH',
          message: 'crypto-booster.trigger.failed',
          payload: {
            accountId: task.accountId,
            market: market.data,
            kind: placed.error.kind,
            reason: placed.error.message,
          },
        });
        this.deps.repo.insertEvent({
          accountId: task.accountId,
          market: market.data,
          mode: 'live-small',
          kind: 'blocked',
          action: 'plan-buy',
          reason: `crypto-booster failed: ${placed.error.message}`,
          intent: null,
          result: { kind: placed.error.kind },
          createdAt: this.now(),
        });
        return;
      }

      this.deps.repo.markLiveAction(task.accountId, market.data, this.now());

      this.deps.rateGuard.recordBuy(task.accountId, market.data, this.now());
      const rateGuardResult = this.deps.rateGuard.checkAndPossiblyDisableAuto(task.accountId);
      if (rateGuardResult.switchedToManual) {
        this.deps.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto-booster.rate-guard.disabled',
          payload: { accountId: task.accountId, market: market.data },
        });
      }

      this.deps.repo.insertEvent({
        accountId: task.accountId,
        market: market.data,
        mode: 'live-small',
        kind: 'live-place',
        action: 'plan-buy',
        reason: 'crypto-booster triggered',
        intent: {
          kind: 'plan-buy',
          market: market.data,
          krwAmount: String(task.amountKrw),
          limitPrice: String(ctx.price),
        },
        result: placed.value,
        createdAt: this.now(),
      });
      this.deps.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'crypto-booster.triggered',
        payload: {
          accountId: task.accountId,
          market: market.data,
          triggerPrice: ctx.price,
          amountKrw: task.amountKrw,
        },
      });
    } catch (cause) {
      const key = entryKey(task.accountId, task.pdno);
      if (!this.retriedTasks.has(key)) {
        // 1차 실패: 5 초 후 1회 재시도 — task 구독은 유지.
        this.retriedTasks.add(key);
        this.deps.timer.setTimeout(() => {
          void this.onTrigger(task, ctx);
        }, 5_000);
        this.deps.logger.log({
          level: 'WARN',
          category: 'WATCH',
          message: 'crypto-booster.trigger.retry-scheduled',
          payload: {
            accountId: task.accountId,
            market: task.pdno,
            reason: cause instanceof Error ? cause.message : String(cause),
          },
        });
        return;
      }
      // 2차 실패: ERROR 로그 후 cleanup.
      this.retriedTasks.delete(key);
      this.deps.logger.log({
        level: 'ERROR',
        category: 'WATCH',
        message: 'crypto-booster.trigger.failed',
        payload: {
          accountId: task.accountId,
          market: task.pdno,
          reason: cause instanceof Error ? cause.message : String(cause),
        },
      });
    }
    this.cleanupSubscription(task.accountId, task.pdno);
  }

  private onExpire(task: BoosterTask): void {
    this.cleanupSubscription(task.accountId, task.pdno);
    this.deps.logger.log({
      level: 'INFO',
      category: 'WATCH',
      message: 'crypto-booster.expired',
      payload: { accountId: task.accountId, market: task.pdno },
    });
  }

  private logTriggerSkipped(
    task: BoosterTask,
    reason: string,
    extra?: Record<string, unknown>,
  ): void {
    this.deps.logger.log({
      level: 'INFO',
      category: 'WATCH',
      message: 'crypto-booster.trigger.skipped',
      payload: { accountId: task.accountId, market: task.pdno, reason, ...extra },
    });
  }

  private cleanupSubscription(accountId: number, market: string): void {
    const key = entryKey(accountId, market);
    const unsub = this.busUnsubs.get(key);
    if (unsub) {
      unsub();
      this.busUnsubs.delete(key);
    }
    const realtime = this.deps.getRealtime();
    realtime?.unwatchMarket({ market, candleUnit: '1m' });
  }
}

/**
 * 1차 매도 체결 평균 가격 계산.
 * - market ask: price 가 undefined 이므로 executedFunds / executedVolume 사용.
 * - limit ask: price 가 곧 limitPrice — 안전 fallback.
 * - division-by-zero / NaN 방어.
 */
function computeLastFilledPrice(event: CryptoPrivateOrderEvent): number | null {
  const funds = event.executedFunds === undefined ? null : Number(event.executedFunds);
  const volume = Number(event.executedVolume);
  if (
    funds !== null &&
    Number.isFinite(funds) &&
    funds > 0 &&
    Number.isFinite(volume) &&
    volume > 0
  ) {
    return funds / volume;
  }
  const price = Number(event.price);
  if (Number.isFinite(price) && price > 0) return price;
  return null;
}

/**
 * 1차 BUY intent 빌드. autoBuyOrderType 에 따라 LIMIT 또는 MARKET(price-bid) 분기.
 * - MARKET: ordType='price' (KRW 금액 지정), bid side, volume 미지정.
 * - LIMIT: ordType='limit', price 와 volume 모두 필요. volume 은 amountKrw / triggerPrice.
 */
function buildBoosterBuyIntent(
  task: BoosterTask,
  market: CryptoKrwMarketCode,
  strategy: CryptoStrategyProfile,
): CryptoOrderIntent {
  const identifier = `crypto-booster:${task.accountId}:${market}:${Date.now()}`.slice(0, 255);
  if (strategy.autoBuyOrderType === 'LIMIT') {
    const triggerPrice = task.lastFilledPrice * Math.max(1 - task.boosterPct, 0.01);
    const volume = task.amountKrw / Math.max(triggerPrice, 1);
    return {
      market,
      side: 'bid',
      ordType: 'limit',
      price: String(triggerPrice),
      volume: String(volume),
      identifier,
    };
  }
  return {
    market,
    side: 'bid',
    ordType: 'price',
    price: String(task.amountKrw),
    identifier,
  };
}

function entryKey(accountId: number, market: string): string {
  return `${accountId}::${market}`;
}
