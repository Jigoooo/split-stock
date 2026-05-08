import type { TradeExecutionEvent } from '@shared/contracts';
import { hasActiveCycle } from '@shared/trading/next-nth';
import type { Timer } from '../kis/ws-client';
import type { FeedBus } from '../realtime/feed-bus';
import type { RealtimeService } from '../realtime/realtime-service';
import { type BoosterTask, type BoosterTriggerContext, BoosterWatcher } from './booster-watcher';
import { resolveStrategyProfile } from './strategy-profile-resolver';
import { executeStrategyOrder } from './watch-order-executor';
import type { StrategyOrderInput, WatchOrderExecutorDeps } from './watch-order-types';

/**
 * NM-004 BoosterService — BoosterWatcher 와 realtime/bus/lotsRepo/strategyRepo/executor 를 묶어
 * 1차 전량 매도 후 부스터 트리거를 자동 등록·실행하는 runtime 서비스.
 *
 * - register 시 realtime.watch(pdno, 'tick') refcount 로 WS 구독 유지 (옵션 A).
 * - 트리거/만료/cancel 시 realtime.unwatch + bus 구독 해제.
 * - executeStrategyOrder 로 1차 BUY 주문. safety/auto-buy-guard/market-session-guard 가 그대로 적용됨.
 */
export interface BoosterServiceDeps extends WatchOrderExecutorDeps {
  timer: Timer;
  bus: FeedBus;
  /** env 전환 시 realtime 가 재생성되므로 callback 으로 주입. null = 미준비. */
  getRealtime: () => RealtimeService | null;
}

export class BoosterService {
  private readonly watcher: BoosterWatcher;
  private readonly busUnsubs = new Map<string, () => void>();
  /** Bd4: 첫 실패 후 5 초 재시도를 예약한 task key 집합. 2차 실패면 cleanup. */
  private readonly retriedTasks = new Set<string>();

  constructor(private readonly deps: BoosterServiceDeps) {
    this.watcher = new BoosterWatcher({
      timer: deps.timer,
      onTrigger: (task, ctx) => {
        void this.onTrigger(task, ctx);
      },
      onExpire: (task) => this.onExpire(task),
    });
  }

  /**
   * watchEvents.broadcastTradeExecution 으로부터 trade event 를 받아 1차 전량 매도 감지.
   * (b) 검증: lots snapshot 으로 hasActiveCycle === false 재확인.
   */
  handleTradeExecution(event: TradeExecutionEvent): void {
    if (
      event.side !== 'SELL' ||
      // nth === null (lotId 없는 manual order) 도 여기서 차단됨 — booster 이중 진입 방지 의도.
      event.nth !== 1 ||
      event.status !== 'FILLED' ||
      event.remainingQty !== 0
    ) {
      return;
    }

    const snapshot = this.deps.lotsRepo.snapshot(event.accountId, event.pdno);
    if (snapshot.isErr()) return;
    // Bd2: event.nth(방금 SELL FILLED 된 1차 lot)는 SELLING 상태로 남아있을 수 있으므로 제외.
    // LotSnapshotEntry 에 id 없음 → nth 로 필터 (1차 = nth=1).
    const otherLots = snapshot.value.lots.filter((l) => l.nth !== event.nth);
    if (hasActiveCycle(otherLots)) return;

    const profile = resolveStrategyProfile(this.deps.strategyRepo, event.accountId, event.pdno);
    if (!profile?.profitBooster?.enabled) return;

    const firstBuyAmount = profile.buyRules[0]?.amountKrw;
    if (firstBuyAmount === undefined || firstBuyAmount <= 0) return;

    const expiresAt = profile.profitBooster.expiresAt;
    const task: BoosterTask = {
      accountId: event.accountId,
      pdno: event.pdno,
      lastFilledPrice: event.price,
      boosterPct: profile.profitBooster.dropPct,
      amountKrw: firstBuyAmount,
      ...(expiresAt !== null && expiresAt !== undefined ? { expiresAt } : {}),
    };

    this.register(task);
    this.deps.logger.log({
      level: 'INFO',
      category: 'WATCH',
      message: 'booster.registered',
      payload: {
        accountId: task.accountId,
        pdno: task.pdno,
        lastFilledPrice: task.lastFilledPrice,
        boosterPct: task.boosterPct,
        amountKrw: task.amountKrw,
      },
    });
  }

  register(task: BoosterTask): void {
    const key = entryKey(task.accountId, task.pdno);
    const realtime = this.deps.getRealtime();
    realtime?.watch(task.pdno, 'tick');

    const prev = this.busUnsubs.get(key);
    if (prev) prev();
    const unsub = this.deps.bus.subscribeTick(task.pdno, (tick) => {
      this.watcher.onPrice(task.accountId, task.pdno, tick.price);
    });
    this.busUnsubs.set(key, unsub);

    this.watcher.register(task);
  }

  cancel(accountId: number, pdno: string): void {
    this.watcher.cancel(accountId, pdno);
    this.cleanupSubscription(accountId, pdno);
  }

  has(accountId: number, pdno: string): boolean {
    return this.watcher.has(accountId, pdno);
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
   * (c) idempotency: 사용자가 수동 1차 매수했을 수 있으므로 hasActiveCycle 재확인.
   * (e) enabled 토글 재확인: 사용자가 부스터 끈 경우 skip.
   * (d) try/catch + logger 기록.
   */
  private async onTrigger(task: BoosterTask, ctx: BoosterTriggerContext): Promise<void> {
    let shouldCleanup = true;
    try {
      const snapshot = this.deps.lotsRepo.snapshot(task.accountId, task.pdno);
      if (snapshot.isErr()) {
        this.logTriggerSkipped(task, 'snapshot-failed', { error: snapshot.error.kind });
        return;
      }
      if (hasActiveCycle(snapshot.value.lots)) {
        this.logTriggerSkipped(task, 'active-cycle-exists');
        return;
      }

      const profile = resolveStrategyProfile(this.deps.strategyRepo, task.accountId, task.pdno);
      if (!profile?.profitBooster?.enabled) {
        this.logTriggerSkipped(task, 'booster-disabled');
        return;
      }

      const division = profile.autoBuyOrderType;
      const price = ctx.price;
      const qty = Math.floor(task.amountKrw / Math.max(price, 1));
      if (qty <= 0) {
        this.logTriggerSkipped(task, 'zero-qty');
        return;
      }

      const input: StrategyOrderInput = {
        accountId: task.accountId,
        pdno: task.pdno,
        side: 'BUY',
        division,
        nth: 1,
        price,
        qty,
        triggerReason: 'DROP_BUY',
      };
      await executeStrategyOrder(this.deps, input);

      this.deps.logger.log({
        level: 'INFO',
        category: 'WATCH',
        message: 'booster.triggered',
        payload: {
          accountId: task.accountId,
          pdno: task.pdno,
          triggerPrice: price,
          qty,
          division,
        },
      });
    } catch (cause) {
      const key = entryKey(task.accountId, task.pdno);
      if (!this.retriedTasks.has(key)) {
        // 1차 실패: 5 초 후 1회 재시도 — task 구독은 유지.
        this.retriedTasks.add(key);
        shouldCleanup = false;
        this.deps.timer.setTimeout(() => {
          void this.onTrigger(task, ctx);
        }, 5_000);
        this.deps.logger.log({
          level: 'WARN',
          category: 'WATCH',
          message: 'booster.trigger.retry-scheduled',
          payload: {
            accountId: task.accountId,
            pdno: task.pdno,
            reason: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } else {
        // 2차 실패: ERROR 로그 후 cleanup.
        this.retriedTasks.delete(key);
        this.deps.logger.log({
          level: 'ERROR',
          category: 'WATCH',
          message: 'booster.trigger.failed',
          payload: {
            accountId: task.accountId,
            pdno: task.pdno,
            reason: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    } finally {
      if (shouldCleanup) {
        this.cleanupSubscription(task.accountId, task.pdno);
      }
    }
  }

  private onExpire(task: BoosterTask): void {
    this.cleanupSubscription(task.accountId, task.pdno);
    this.deps.logger.log({
      level: 'INFO',
      category: 'WATCH',
      message: 'booster.expired',
      payload: { accountId: task.accountId, pdno: task.pdno },
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
      message: 'booster.trigger.skipped',
      payload: { accountId: task.accountId, pdno: task.pdno, reason, ...extra },
    });
  }

  private cleanupSubscription(accountId: number, pdno: string): void {
    const key = entryKey(accountId, pdno);
    const unsub = this.busUnsubs.get(key);
    if (unsub) {
      unsub();
      this.busUnsubs.delete(key);
    }
    const realtime = this.deps.getRealtime();
    realtime?.unwatch(pdno, 'tick');
  }
}

function entryKey(accountId: number, pdno: string): string {
  return `${accountId}::${pdno}`;
}
