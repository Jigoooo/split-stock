import type { OrderbookUpdate, TickUpdate } from '../kis/ws-frame-parser';

type Listener<T> = (payload: T) => void;

interface TopicListeners {
  tick: Set<Listener<TickUpdate>>;
  orderbook: Set<Listener<OrderbookUpdate>>;
}

/**
 * 종목별 실시간 데이터 pub/sub 버스 (in-process).
 * - WS parser가 emit → trpc subscription observer가 subscribe
 * - 종목별 구독자 수 추적: getSubscriberCount(pdno) === 0 → 호출측이 WS unsubscribe 수행
 * - 최신 스냅샷 보관: 신규 구독자에게 즉시 전달하여 초기 렌더 빈 화면 방지
 */
export class FeedBus {
  private readonly byPdno = new Map<string, TopicListeners>();
  private readonly latestTick = new Map<string, TickUpdate>();
  private readonly latestOrderbook = new Map<string, OrderbookUpdate>();

  private ensure(pdno: string): TopicListeners {
    let entry = this.byPdno.get(pdno);
    if (!entry) {
      entry = { tick: new Set(), orderbook: new Set() };
      this.byPdno.set(pdno, entry);
    }
    return entry;
  }

  emitTick(update: TickUpdate): void {
    this.latestTick.set(update.pdno, update);
    const entry = this.byPdno.get(update.pdno);
    if (!entry) return;
    for (const l of Array.from(entry.tick)) l(update);
  }

  emitOrderbook(update: OrderbookUpdate): void {
    this.latestOrderbook.set(update.pdno, update);
    const entry = this.byPdno.get(update.pdno);
    if (!entry) return;
    for (const l of Array.from(entry.orderbook)) l(update);
  }

  subscribeTick(pdno: string, listener: Listener<TickUpdate>): () => void {
    const entry = this.ensure(pdno);
    entry.tick.add(listener);
    // 초기 스냅샷: 최근 tick이 있으면 즉시 전달
    const snapshot = this.latestTick.get(pdno);
    if (snapshot) listener(snapshot);
    return () => {
      entry.tick.delete(listener);
    };
  }

  subscribeOrderbook(pdno: string, listener: Listener<OrderbookUpdate>): () => void {
    const entry = this.ensure(pdno);
    entry.orderbook.add(listener);
    const snapshot = this.latestOrderbook.get(pdno);
    if (snapshot) listener(snapshot);
    return () => {
      entry.orderbook.delete(listener);
    };
  }

  getSubscriberCount(pdno: string): { tick: number; orderbook: number } {
    const entry = this.byPdno.get(pdno);
    return { tick: entry?.tick.size ?? 0, orderbook: entry?.orderbook.size ?? 0 };
  }

  getLatestTick(pdno: string): TickUpdate | null {
    return this.latestTick.get(pdno) ?? null;
  }

  getLatestOrderbook(pdno: string): OrderbookUpdate | null {
    return this.latestOrderbook.get(pdno) ?? null;
  }

  clear(): void {
    this.byPdno.clear();
    this.latestTick.clear();
    this.latestOrderbook.clear();
  }
}
