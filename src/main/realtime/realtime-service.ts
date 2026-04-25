import type { AppEnv } from '@shared/contracts';
import type { KisHttpClient } from '../kis/http-client';
import {
  KisWsClient,
  type RealtimeTr,
  realTimer,
  type SubscriptionKey,
  type Timer,
  type WsFactory,
} from '../kis/ws-client';
import {
  type OrderbookUpdate,
  parseH0STASP0,
  parseH0STCNT0,
  type TickUpdate,
} from '../kis/ws-frame-parser';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from './feed-bus';
import {
  type RestFallbackAdapter,
  type WsKind,
  WsPoolManager,
  type WsPoolSubscriptionView,
  type WsSubscribeAdapter,
} from './ws-pool-manager';

/**
 * 기존 watch/unwatch 호출자(use-live-feed 등)가 사용하는 topic 별칭.
 * 신규 호출자는 focus(pdno) + WsPoolManager priority 시스템 사용 권장 — tick=PRICE, orderbook=ORDERBOOK 매핑.
 */
export type RealtimeTopic = 'tick' | 'orderbook';

/**
 * Renderer 가 watch/unwatch 시 부여되는 default priority — "자동감시 (watch-engine)" 등급.
 * 사용자가 보고 있는 종목은 RealtimeService.focus(pdno) 로 100 으로 끌어올린다.
 */
const DEFAULT_WATCH_PRIORITY = 60;
const FOCUS_PRIORITY = 100;

interface WatchEntry {
  pdno: string;
  /** topic 별 refcount (BC). */
  tick: number;
  orderbook: number;
}

export interface RealtimeServiceDeps {
  env: AppEnv;
  http: KisHttpClient;
  bus: FeedBus;
  factory: WsFactory;
  logger: EventLogger;
  /** 최대 동시 구독 종목(KIS 기본 20, 향후 60). tick+orderbook 합산 슬롯. */
  maxSubscriptions?: number;
  timer?: Timer;
  /**
   * 활성 계좌 ID 를 lazy 하게 가져오는 getter — env 전환/계좌 전환 후에도 최신 값 반영.
   * 미주입 시 0 (default 슬롯) 사용 — 단일 계좌 환경 호환.
   */
  getAccountId?: () => number | null;
  /**
   * REST 폴링 fallback 어댑터 — capacity 초과 종목을 RotatingQuoteFeed 에 위임.
   * 미주입 시 fallback 없음 (기존 BC: WS 슬롯 부족 → 조용히 미구독).
   */
  restFallback?: RestFallbackAdapter;
  /**
   * WS Pool 재배치 debounce ms (기본 200). 0 이면 즉시 동기 적용 — 테스트용.
   */
  rebalanceDebounceMs?: number;
}

/**
 * KisWsClient + WsPoolManager + FeedBus 를 묶은 통합 실시간 서비스.
 *
 * 변경(W2-N): 기존 단일 KisWsClient + topic refcount 구조에서
 * WsPoolManager 기반 우선순위 라우팅으로 전환. BC 보존:
 *   - watch(pdno, topic) / unwatch(pdno, topic) 인터페이스는 그대로 (priority=60 기본)
 *   - getWatched() 도 그대로 — pdno × {tick,orderbook} refcount 반환
 *
 * 신규:
 *   - focus(pdno) / blur(pdno) — 사용자가 보는 종목 priority 100 토글
 *   - setSessionCapacity(capacity) — KIS 한도 변경 시 동적 적용
 *   - getActiveSubscriptions() — WS/REST 라우팅 결과 조회 (renderer 인디케이터용)
 */
export class RealtimeService {
  private readonly deps: RealtimeServiceDeps;
  private readonly watches = new Map<string, WatchEntry>();
  /** 사용자가 보고 있는 종목 (focus 우선순위 부여). */
  private readonly focused = new Set<string>();
  private readonly timer: Timer;
  private readonly getAccountId: () => number | null;
  private client: KisWsClient | null = null;
  private pool: WsPoolManager | null = null;
  private started = false;

  constructor(deps: RealtimeServiceDeps) {
    this.deps = deps;
    this.timer = deps.timer ?? realTimer;
    this.getAccountId = deps.getAccountId ?? (() => null);
  }

  async start(appKey: string, appSecret: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.started && this.client) return { ok: true };
    const client = new KisWsClient({
      env: this.deps.env,
      http: this.deps.http,
      factory: this.deps.factory,
      logger: this.deps.logger,
      ...(this.deps.maxSubscriptions !== undefined && {
        maxSubscriptions: this.deps.maxSubscriptions,
      }),
      onMessage: (msg) => this.dispatchFrame(msg),
    });
    const r = await client.start(appKey, appSecret);
    if (r.isErr()) {
      this.deps.logger.log({
        level: 'ERROR',
        category: 'WS',
        message: 'realtime.start_failed',
        payload: { kind: r.error.kind, msg: r.error.msg },
      });
      return { ok: false, reason: r.error.msg };
    }
    this.client = client;
    this.pool = new WsPoolManager({
      defaultCapacity: this.deps.maxSubscriptions ?? 20,
      ws: this.buildWsAdapter(),
      rest: this.deps.restFallback ?? createNoopRestAdapter(),
      logger: this.deps.logger,
      timer: this.timer,
      ...(this.deps.rebalanceDebounceMs !== undefined && {
        rebalanceDebounceMs: this.deps.rebalanceDebounceMs,
      }),
    });
    this.started = true;
    // 기존 watch 복원 — 재시작 시 우선순위 기반 재배치
    for (const [, entry] of this.watches) this.republishToPool(entry);
    this.deps.logger.log({ level: 'INFO', category: 'WS', message: 'realtime.started' });
    return { ok: true };
  }

  stop(): void {
    if (this.pool) {
      this.pool.dispose();
      this.pool = null;
    }
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    this.started = false;
    this.deps.logger.log({ level: 'INFO', category: 'WS', message: 'realtime.stopped' });
  }

  isStarted(): boolean {
    return this.started;
  }

  /** [BC] tick/orderbook 별 refcount 증가. priority=60 으로 WsPoolManager 등록. */
  watch(pdno: string, topic: RealtimeTopic): void {
    let entry = this.watches.get(pdno);
    if (!entry) {
      entry = { pdno, tick: 0, orderbook: 0 };
      this.watches.set(pdno, entry);
    }
    entry[topic] += 1;
    this.republishToPool(entry);
  }

  unwatch(pdno: string, topic: RealtimeTopic): void {
    const entry = this.watches.get(pdno);
    if (!entry) return;
    entry[topic] = Math.max(0, entry[topic] - 1);
    if (entry.tick === 0 && entry.orderbook === 0) {
      this.watches.delete(pdno);
      this.focused.delete(pdno);
      if (this.pool) this.pool.unsubscribe(this.getAccountIdOrZero(), pdno);
    } else {
      this.republishToPool(entry);
    }
  }

  /** 사용자가 보고 있는 종목 — priority=100. 다른 종목 focus 시 이전 종목은 자동으로 blur. */
  focus(pdno: string): void {
    // 단일 focus 정책: 새 focus 가 들어오면 이전 focus 는 모두 해제 (priority 강등)
    for (const prev of Array.from(this.focused)) {
      if (prev === pdno) continue;
      this.focused.delete(prev);
      const prevEntry = this.watches.get(prev);
      if (prevEntry) this.republishToPool(prevEntry);
    }
    this.focused.add(pdno);
    let entry = this.watches.get(pdno);
    if (!entry) {
      // focus 만 호출되고 watch 가 없는 케이스 — UI 가 직접 호출하면 BOTH 로 등록
      entry = { pdno, tick: 1, orderbook: 1 };
      this.watches.set(pdno, entry);
    }
    this.republishToPool(entry);
  }

  blur(pdno: string): void {
    if (!this.focused.delete(pdno)) return;
    const entry = this.watches.get(pdno);
    if (entry) this.republishToPool(entry);
  }

  /** KIS 세션 한도 동적 변경 — capacity=60 으로 끌어올릴 때 호출. */
  setSessionCapacity(capacity: number): void {
    this.pool?.setSessionCapacity(this.getAccountIdOrZero(), capacity);
  }

  /** WS/REST 라우팅 결과 조회 — renderer 폴링 인디케이터에 노출. */
  getActiveSubscriptions(): WsPoolSubscriptionView[] {
    if (!this.pool) return [];
    return this.pool.getActiveSubscriptions(this.getAccountIdOrZero());
  }

  /** 현재 활성 계좌의 WS 슬롯 capacity. UI 표시용. */
  getSessionCapacity(): number {
    if (!this.pool) return 0;
    return this.pool.getCapacity(this.getAccountIdOrZero());
  }

  /** [BC] tick/orderbook refcount 스냅샷. */
  getWatched(): Array<{ pdno: string; tick: number; orderbook: number }> {
    return Array.from(this.watches.values()).map((e) => ({ ...e }));
  }

  /* ----------------------------- internals ------------------------------ */

  private getAccountIdOrZero(): number {
    const id = this.getAccountId();
    return id ?? 0;
  }

  private kindFor(entry: WatchEntry): WsKind | null {
    if (entry.tick > 0 && entry.orderbook > 0) return 'BOTH';
    if (entry.tick > 0) return 'PRICE';
    if (entry.orderbook > 0) return 'ORDERBOOK';
    return null;
  }

  private republishToPool(entry: WatchEntry): void {
    if (!this.pool) return;
    const kind = this.kindFor(entry);
    const accountId = this.getAccountIdOrZero();
    if (!kind) {
      this.pool.unsubscribe(accountId, entry.pdno);
      return;
    }
    const priority = this.focused.has(entry.pdno) ? FOCUS_PRIORITY : DEFAULT_WATCH_PRIORITY;
    this.pool.subscribe({ accountId, pdno: entry.pdno, kind, priority });
  }

  private buildWsAdapter(): WsSubscribeAdapter {
    return {
      subscribe: (_accountId, pdno, kind) => {
        if (!this.client) return;
        if (kind === 'PRICE' || kind === 'BOTH') this.subscribeRaw(pdno, 'H0STCNT0');
        if (kind === 'ORDERBOOK' || kind === 'BOTH') this.subscribeRaw(pdno, 'H0STASP0');
      },
      unsubscribe: (_accountId, pdno, kind) => {
        if (!this.client) return;
        if (kind === 'PRICE' || kind === 'BOTH') this.unsubscribeRaw(pdno, 'H0STCNT0');
        if (kind === 'ORDERBOOK' || kind === 'BOTH') this.unsubscribeRaw(pdno, 'H0STASP0');
      },
    };
  }

  private subscribeRaw(pdno: string, tr: RealtimeTr): void {
    if (!this.client) return;
    const key: SubscriptionKey = { tr, code: pdno };
    const r = this.client.subscribe(key);
    if (r.isErr()) {
      this.deps.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'realtime.subscribe_failed',
        payload: { tr, pdno, kind: r.error.kind, msg: r.error.msg },
      });
    }
  }

  private unsubscribeRaw(pdno: string, tr: RealtimeTr): void {
    if (!this.client) return;
    this.client.unsubscribe({ tr, code: pdno });
  }

  private dispatchFrame(msg: { tr: string; raw: string }): void {
    if (msg.tr === 'H0STCNT0') {
      for (const t of parseH0STCNT0(msg.raw)) this.deps.bus.emitTick(t);
    } else if (msg.tr === 'H0STASP0') {
      for (const o of parseH0STASP0(msg.raw)) this.deps.bus.emitOrderbook(o);
    }
  }
}

function createNoopRestAdapter(): RestFallbackAdapter {
  return {
    subscribe: () => undefined,
    unsubscribe: () => undefined,
  };
}

// Re-export types used by callers
export type { OrderbookUpdate, TickUpdate };
