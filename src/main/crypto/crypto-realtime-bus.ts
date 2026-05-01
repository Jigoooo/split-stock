import type {
  CryptoPrivateAssetEvent,
  CryptoPrivateOrderEvent,
  CryptoRealtimeCandle,
  CryptoRealtimeOrderbook,
  CryptoRealtimeTicker,
  CryptoRealtimeTrade,
} from '@shared/contracts';

type Unsubscribe = () => void;
type Listener<T> = (value: T) => void;
type MarketTopic = 'ticker' | 'trade' | 'orderbook' | 'candle';
type PrivateTopic = 'order' | 'asset';

export class CryptoRealtimeBus {
  private readonly latestTicker = new Map<string, CryptoRealtimeTicker>();
  private readonly latestTrade = new Map<string, CryptoRealtimeTrade>();
  private readonly latestOrderbook = new Map<string, CryptoRealtimeOrderbook>();
  private readonly latestCandle = new Map<string, CryptoRealtimeCandle>();
  private readonly marketSubscribers = new Map<MarketTopic, Map<string, Set<Listener<unknown>>>>();
  private readonly privateSubscribers = new Map<
    PrivateTopic,
    Map<number, Set<Listener<unknown>>>
  >();

  getLatestTicker(market: string): CryptoRealtimeTicker | null {
    return this.latestTicker.get(market) ?? null;
  }

  getLatestTrade(market: string): CryptoRealtimeTrade | null {
    return this.latestTrade.get(market) ?? null;
  }

  getLatestOrderbook(market: string): CryptoRealtimeOrderbook | null {
    return this.latestOrderbook.get(market) ?? null;
  }

  getLatestCandle(market: string): CryptoRealtimeCandle | null {
    return this.latestCandle.get(market) ?? null;
  }

  getLatestRealtime(market: string): {
    ticker: CryptoRealtimeTicker | null;
    trade: CryptoRealtimeTrade | null;
    orderbook: CryptoRealtimeOrderbook | null;
    candle: CryptoRealtimeCandle | null;
  } {
    return {
      ticker: this.getLatestTicker(market),
      trade: this.getLatestTrade(market),
      orderbook: this.getLatestOrderbook(market),
      candle: this.getLatestCandle(market),
    };
  }

  publishTicker(value: CryptoRealtimeTicker): void {
    this.latestTicker.set(value.market, value);
    this.emitMarket('ticker', value.market, value);
  }

  publishTrade(value: CryptoRealtimeTrade): void {
    this.latestTrade.set(value.market, value);
    this.emitMarket('trade', value.market, value);
  }

  publishOrderbook(value: CryptoRealtimeOrderbook): void {
    this.latestOrderbook.set(value.market, value);
    this.emitMarket('orderbook', value.market, value);
  }

  publishCandle(value: CryptoRealtimeCandle): void {
    this.latestCandle.set(value.market, value);
    this.emitMarket('candle', value.market, value);
  }

  publishPrivateOrder(value: CryptoPrivateOrderEvent): void {
    this.emitPrivate('order', value.accountId, value);
  }

  publishPrivateAsset(value: CryptoPrivateAssetEvent): void {
    this.emitPrivate('asset', value.accountId, value);
  }

  subscribeTicker(market: string, listener: Listener<CryptoRealtimeTicker>): Unsubscribe {
    return this.subscribeMarket('ticker', market, listener, this.latestTicker.get(market));
  }

  subscribeTrade(market: string, listener: Listener<CryptoRealtimeTrade>): Unsubscribe {
    return this.subscribeMarket('trade', market, listener, this.latestTrade.get(market));
  }

  subscribeOrderbook(market: string, listener: Listener<CryptoRealtimeOrderbook>): Unsubscribe {
    return this.subscribeMarket('orderbook', market, listener, this.latestOrderbook.get(market));
  }

  subscribeCandle(market: string, listener: Listener<CryptoRealtimeCandle>): Unsubscribe {
    return this.subscribeMarket('candle', market, listener, this.latestCandle.get(market));
  }

  subscribePrivateOrder(
    accountId: number,
    listener: Listener<CryptoPrivateOrderEvent>,
  ): Unsubscribe {
    return this.subscribePrivate('order', accountId, listener);
  }

  subscribePrivateAsset(
    accountId: number,
    listener: Listener<CryptoPrivateAssetEvent>,
  ): Unsubscribe {
    return this.subscribePrivate('asset', accountId, listener);
  }

  private subscribeMarket<T>(
    topic: MarketTopic,
    market: string,
    listener: Listener<T>,
    latest: T | undefined,
  ): Unsubscribe {
    let byMarket = this.marketSubscribers.get(topic);
    if (!byMarket) {
      byMarket = new Map();
      this.marketSubscribers.set(topic, byMarket);
    }
    let listeners = byMarket.get(market);
    if (!listeners) {
      listeners = new Set();
      byMarket.set(market, listeners);
    }
    listeners.add(listener as Listener<unknown>);
    if (latest !== undefined) listener(latest);
    return () => {
      listeners?.delete(listener as Listener<unknown>);
      if (listeners?.size === 0) byMarket?.delete(market);
    };
  }

  private subscribePrivate<T>(
    topic: PrivateTopic,
    accountId: number,
    listener: Listener<T>,
  ): Unsubscribe {
    let byAccount = this.privateSubscribers.get(topic);
    if (!byAccount) {
      byAccount = new Map();
      this.privateSubscribers.set(topic, byAccount);
    }
    let listeners = byAccount.get(accountId);
    if (!listeners) {
      listeners = new Set();
      byAccount.set(accountId, listeners);
    }
    listeners.add(listener as Listener<unknown>);
    return () => {
      listeners?.delete(listener as Listener<unknown>);
      if (listeners?.size === 0) byAccount?.delete(accountId);
    };
  }

  private emitMarket<T>(topic: MarketTopic, market: string, value: T): void {
    const listeners = this.marketSubscribers.get(topic)?.get(market);
    if (!listeners) return;
    for (const listener of listeners) listener(value);
  }

  private emitPrivate<T>(topic: PrivateTopic, accountId: number, value: T): void {
    const listeners = this.privateSubscribers.get(topic)?.get(accountId);
    if (!listeners) return;
    for (const listener of listeners) listener(value);
  }
}
