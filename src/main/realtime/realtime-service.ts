import type { AppEnv } from '@shared/contracts';
import type { KisHttpClient } from '../kis/http-client';
import {
  KisWsClient,
  type RealtimeTr,
  type SubscriptionKey,
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

export type RealtimeTopic = 'tick' | 'orderbook';

interface WatchEntry {
  pdno: string;
  tick: number; // refcount
  orderbook: number;
}

export interface RealtimeServiceDeps {
  env: AppEnv;
  http: KisHttpClient;
  bus: FeedBus;
  factory: WsFactory;
  logger: EventLogger;
  /** 최대 동시 구독 종목(KIS 기본 20). tick+orderbook 각 1씩 슬롯 소비. */
  maxSubscriptions?: number;
}

/**
 * KisWsClient + FeedBus 결합 서비스.
 * - Renderer가 watch/unwatch를 호출하면 ref count로 KIS WS subscribe/unsubscribe 제어
 * - 수신 프레임을 parser로 정규화 후 FeedBus.emit 호출
 * - stop 시 모든 WS 연결 종료
 */
export class RealtimeService {
  private readonly deps: RealtimeServiceDeps;
  private readonly watches = new Map<string, WatchEntry>();
  private client: KisWsClient | null = null;
  private started = false;

  constructor(deps: RealtimeServiceDeps) {
    this.deps = deps;
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
    this.started = true;
    // 기존 watch 복원 (재시작 시)
    for (const [, entry] of this.watches) {
      this.ensureWsSubscription(entry);
    }
    this.deps.logger.log({ level: 'INFO', category: 'WS', message: 'realtime.started' });
    return { ok: true };
  }

  stop(): void {
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

  /** 구독 참조 카운트 증가. 첫 구독이면 실제 WS subscribe. */
  watch(pdno: string, topic: RealtimeTopic): void {
    let entry = this.watches.get(pdno);
    if (!entry) {
      entry = { pdno, tick: 0, orderbook: 0 };
      this.watches.set(pdno, entry);
    }
    entry[topic] += 1;
    this.ensureWsSubscription(entry);
  }

  unwatch(pdno: string, topic: RealtimeTopic): void {
    const entry = this.watches.get(pdno);
    if (!entry) return;
    entry[topic] = Math.max(0, entry[topic] - 1);
    this.reconcileWsSubscription(entry);
    if (entry.tick === 0 && entry.orderbook === 0) {
      this.watches.delete(pdno);
    }
  }

  getWatched(): Array<{ pdno: string; tick: number; orderbook: number }> {
    return Array.from(this.watches.values()).map((e) => ({ ...e }));
  }

  private ensureWsSubscription(entry: WatchEntry): void {
    if (!this.client) return;
    if (entry.tick > 0) this.subscribe(entry.pdno, 'H0STCNT0');
    if (entry.orderbook > 0) this.subscribe(entry.pdno, 'H0STASP0');
  }

  private reconcileWsSubscription(entry: WatchEntry): void {
    if (!this.client) return;
    if (entry.tick === 0) this.unsubscribe(entry.pdno, 'H0STCNT0');
    if (entry.orderbook === 0) this.unsubscribe(entry.pdno, 'H0STASP0');
  }

  private subscribe(pdno: string, tr: RealtimeTr): void {
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

  private unsubscribe(pdno: string, tr: RealtimeTr): void {
    if (!this.client) return;
    this.client.unsubscribe({ tr, code: pdno });
  }

  private dispatchFrame(msg: { tr: string; raw: string }): void {
    if (msg.tr === 'H0STCNT0') {
      for (const t of parseH0STCNT0(msg.raw)) {
        this.deps.bus.emitTick(t);
      }
    } else if (msg.tr === 'H0STASP0') {
      for (const o of parseH0STASP0(msg.raw)) {
        this.deps.bus.emitOrderbook(o);
      }
    }
  }
}

// Re-export types used by callers
export type { OrderbookUpdate, TickUpdate };
