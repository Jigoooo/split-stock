import type { Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';

export type QuoteTier = 'ws' | 'rest';

export interface QuoteUpdate {
  pdno: string;
  price: number;
  at: number;
}

export interface PricePoller {
  /** 지정 종목 현재가 조회. 실패 시 onError 호출. */
  fetch(pdno: string): Promise<{ price: number } | { error: string }>;
}

export interface TieredQuoteFeedOptions {
  timer: Timer;
  logger: EventLogger;
  poller: PricePoller;
  /** WS tier 최대 슬롯. KIS 실전 20. */
  maxWsSlots?: number;
  /** REST tier polling 주기 ms. */
  restIntervalMs?: number;
  /** WS tier 핸들러 — 구독 추가/제거는 호출측이 KisWsClient에 위임. */
  wsSubscribe?: (pdno: string) => void;
  wsUnsubscribe?: (pdno: string) => void;
  onUpdate?: (update: QuoteUpdate) => void;
}

interface WatchEntry {
  pdno: string;
  /** 요청된 선호 tier. 실제 배정 tier는 allocatedTier. */
  preferredTier: QuoteTier;
  allocatedTier: QuoteTier;
}

/**
 * 티어드 시세 피드 — WS 슬롯이 부족하면 REST polling으로 강등, 여유가 생기면 승격.
 * 실제 WS/REST 호출은 주입된 콜백/poller에 위임 (테스트 용이).
 *
 * 불변식:
 * - 동일 pdno 중복 watch → 우선 tier 업그레이드 요청으로 해석
 * - WS 슬롯 초과 시 강등(rest tier로 배정), 자유 슬롯 생기면 rest→ws로 승격
 * - REST polling은 단일 주기 interval로 현재 rest 배정 전체 순회
 */
export class TieredQuoteFeed {
  private readonly maxWs: number;
  private readonly restIntervalMs: number;
  private readonly watches = new Map<string, WatchEntry>();
  private restHandle: { clear: () => void } | null = null;

  constructor(private readonly opts: TieredQuoteFeedOptions) {
    this.maxWs = opts.maxWsSlots ?? 20;
    this.restIntervalMs = opts.restIntervalMs ?? 5_000;
  }

  getAllocations(): Array<{ pdno: string; tier: QuoteTier }> {
    return Array.from(this.watches.values()).map((w) => ({
      pdno: w.pdno,
      tier: w.allocatedTier,
    }));
  }

  wsSlotsUsed(): number {
    let n = 0;
    for (const w of this.watches.values()) if (w.allocatedTier === 'ws') n += 1;
    return n;
  }

  watch(req: { pdno: string; tier: QuoteTier }): void {
    const existing = this.watches.get(req.pdno);
    if (existing) {
      // 이미 감시 중 → preferredTier 업그레이드 요청만 반영
      if (req.tier === 'ws' && existing.preferredTier !== 'ws') {
        existing.preferredTier = 'ws';
        this.rebalance();
      }
      return;
    }
    const allocatedTier = this.decideTier(req.tier);
    const entry: WatchEntry = {
      pdno: req.pdno,
      preferredTier: req.tier,
      allocatedTier,
    };
    this.watches.set(req.pdno, entry);
    if (allocatedTier === 'ws') this.opts.wsSubscribe?.(req.pdno);
    this.ensureRestLoop();
  }

  unwatch(pdno: string): void {
    const entry = this.watches.get(pdno);
    if (!entry) return;
    this.watches.delete(pdno);
    if (entry.allocatedTier === 'ws') this.opts.wsUnsubscribe?.(pdno);
    this.rebalance();
  }

  /**
   * WS에서 수신한 실시간 가격 — 외부에서 호출.
   */
  acceptWsUpdate(update: QuoteUpdate): void {
    const entry = this.watches.get(update.pdno);
    if (!entry || entry.allocatedTier !== 'ws') return;
    this.opts.onUpdate?.(update);
  }

  dispose(): void {
    this.restHandle?.clear();
    this.restHandle = null;
    for (const w of this.watches.values()) {
      if (w.allocatedTier === 'ws') this.opts.wsUnsubscribe?.(w.pdno);
    }
    this.watches.clear();
  }

  private decideTier(preferred: QuoteTier): QuoteTier {
    if (preferred === 'rest') return 'rest';
    return this.wsSlotsUsed() < this.maxWs ? 'ws' : 'rest';
  }

  private rebalance(): void {
    // WS 슬롯 여유가 생기면, rest 배정 중 ws를 선호하는 것부터 승격.
    const slotsFree = this.maxWs - this.wsSlotsUsed();
    if (slotsFree <= 0) return;
    let promoted = 0;
    for (const w of this.watches.values()) {
      if (promoted >= slotsFree) break;
      if (w.allocatedTier === 'rest' && w.preferredTier === 'ws') {
        w.allocatedTier = 'ws';
        this.opts.wsSubscribe?.(w.pdno);
        promoted += 1;
        this.opts.logger.log({
          level: 'INFO',
          category: 'WS',
          message: 'tiered.promoted',
          payload: { pdno: w.pdno },
        });
      }
    }
  }

  private ensureRestLoop(): void {
    if (this.restHandle) return;
    this.restHandle = this.opts.timer.setInterval(() => {
      void this.pollRestBatch();
    }, this.restIntervalMs);
  }

  private async pollRestBatch(): Promise<void> {
    const targets = Array.from(this.watches.values()).filter((w) => w.allocatedTier === 'rest');
    for (const w of targets) {
      const r = await this.opts.poller.fetch(w.pdno);
      if ('error' in r) {
        this.opts.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'tiered.rest.fetch_failed',
          payload: { pdno: w.pdno, error: r.error },
        });
        continue;
      }
      this.opts.onUpdate?.({ pdno: w.pdno, price: r.price, at: this.opts.timer.now() });
    }
  }
}
