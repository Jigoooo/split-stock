import {
  type CryptoCandleUnit,
  CryptoMarketCodeSchema,
  type CryptoPrivateAssetEvent,
  type CryptoPrivateOrderEvent,
  type CryptoRealtimeCandle,
  type CryptoRealtimeOrderbook,
  type CryptoRealtimeTicker,
  type CryptoRealtimeTrade,
} from '@shared/contracts';
import Upbit from '@upbit-official/upbit-sdk';
import type { CryptoPublicRealtimeEvent, CryptoRealtimeAdapter } from '../ports';
import { decimalString } from './decimal';
import { sharedUpbitRateLimiter, type UpbitRateLimiter } from './rate-limiter';

type WsStreamManager = ReturnType<Upbit['wsStream']['subscribe']>;

export interface UpbitRealtimeClientOptions {
  accessKey?: string;
  secretKey?: string;
  client?: Upbit;
  limiter?: UpbitRateLimiter;
}

export class UpbitRealtimeClient implements CryptoRealtimeAdapter {
  private readonly client: Upbit;
  private readonly limiter: UpbitRateLimiter;

  constructor(options: UpbitRealtimeClientOptions = {}) {
    this.client =
      options.client ??
      new Upbit({
        accessKey: options.accessKey ?? null,
        secretKey: options.secretKey ?? null,
        environment: 'kr',
      });
    this.limiter = options.limiter ?? sharedUpbitRateLimiter;
  }

  watchPublic(input: {
    market: string;
    candleUnit: CryptoCandleUnit;
    onEvent: (event: CryptoPublicRealtimeEvent) => void;
    onError?: (cause: unknown) => void;
  }): { close(): void } {
    let closed = false;
    let manager: WsStreamManager | null = null;

    void (async () => {
      try {
        await this.limiter.schedule('websocket-connect', async () => undefined);
        await this.limiter.schedule('websocket-message', async () => undefined);
        manager = this.client.wsStream.subscribe({
          ticker: [input.market],
          trade: [input.market],
          orderbook: [input.market],
          candle: { codes: [input.market], interval: toWsCandleInterval(input.candleUnit) },
          maxRetries: 5,
          retryDelayMs: 1000,
        });

        for await (const raw of manager) {
          if (closed) break;
          const event = mapPublicEvent(raw, input.candleUnit);
          if (event) input.onEvent(event);
        }
      } catch (cause) {
        if (!closed) input.onError?.(cause);
      }
    })();

    return {
      close: () => {
        closed = true;
        manager?.close();
      },
    };
  }

  watchPrivate(input: {
    accountId: number;
    markets?: string[];
    onOrder: (event: CryptoPrivateOrderEvent) => void;
    onAsset: (event: CryptoPrivateAssetEvent) => void;
    onError?: (cause: unknown) => void;
  }): { close(): void } {
    let closed = false;
    let manager: ReturnType<Upbit['wsStream']['subscribePrivate']> | null = null;

    void (async () => {
      try {
        await this.limiter.schedule('websocket-connect', async () => undefined);
        await this.limiter.schedule('websocket-message', async () => undefined);
        manager = this.client.wsStream.subscribePrivate({
          myOrder: input.markets ?? [],
          myAsset: true,
          maxRetries: 5,
          retryDelayMs: 1000,
        });

        for await (const raw of manager) {
          if (closed) break;
          if (isRecord(raw) && raw.type === 'myOrder') {
            const event = mapPrivateOrderEvent(input.accountId, raw);
            if (event) input.onOrder(event);
          } else if (isRecord(raw) && raw.type === 'myAsset') {
            const event = mapPrivateAssetEvent(input.accountId, raw);
            if (event) input.onAsset(event);
          }
        }
      } catch (cause) {
        if (!closed) input.onError?.(cause);
      }
    })();

    return {
      close: () => {
        closed = true;
        manager?.close();
      },
    };
  }
}

function toWsCandleInterval(unit: CryptoCandleUnit): string {
  return unit.endsWith('m') ? unit : '1m';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMarket(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return CryptoMarketCodeSchema.safeParse(value).success ? value : null;
}

function parseNumber(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function mapPublicEvent(
  raw: unknown,
  candleUnit: CryptoCandleUnit,
): CryptoPublicRealtimeEvent | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'ticker') {
    const value = mapTicker(raw);
    return value ? { kind: 'ticker', value } : null;
  }
  if (raw.type === 'trade') {
    const value = mapTrade(raw);
    return value ? { kind: 'trade', value } : null;
  }
  if (raw.type === 'orderbook') {
    const value = mapOrderbook(raw);
    return value ? { kind: 'orderbook', value } : null;
  }
  if (typeof raw.type === 'string' && raw.type.startsWith('candle.')) {
    const value = mapCandle(raw, candleUnit);
    return value ? { kind: 'candle', value } : null;
  }
  return null;
}

function mapTicker(raw: Record<string, unknown>): CryptoRealtimeTicker | null {
  const market = parseMarket(raw.code);
  if (!market) return null;
  const timestamp = parseNumber(raw.timestamp);
  return {
    exchange: 'UPBIT',
    market,
    tradePrice: decimalString(raw.trade_price),
    openingPrice: decimalString(raw.opening_price),
    highPrice: decimalString(raw.high_price),
    lowPrice: decimalString(raw.low_price),
    signedChangePrice: decimalString(raw.signed_change_price),
    signedChangeRate: decimalString(raw.signed_change_rate),
    accTradePrice24h: decimalString(raw.acc_trade_price_24h),
    accTradeVolume24h: decimalString(raw.acc_trade_volume_24h),
    timestamp,
    receivedAt: Date.now(),
    ...(typeof raw.change === 'string' ? { change: raw.change as 'RISE' | 'EVEN' | 'FALL' } : {}),
    ...(typeof raw.stream_type === 'string'
      ? { streamType: raw.stream_type as 'SNAPSHOT' | 'REALTIME' }
      : {}),
  };
}

function mapTrade(raw: Record<string, unknown>): CryptoRealtimeTrade | null {
  const market = parseMarket(raw.code);
  if (!market) return null;
  const timestamp = parseNumber(raw.timestamp);
  return {
    exchange: 'UPBIT',
    market,
    tradePrice: decimalString(raw.trade_price),
    tradeVolume: decimalString(raw.trade_volume),
    askBid: typeof raw.ask_bid === 'string' ? raw.ask_bid : '',
    ...(typeof raw.change === 'string' ? { change: raw.change as 'RISE' | 'EVEN' | 'FALL' } : {}),
    ...(typeof raw.sequential_id === 'number' ? { sequentialId: raw.sequential_id } : {}),
    tradeTimestamp: parseNumber(raw.trade_timestamp, timestamp),
    timestamp,
    receivedAt: Date.now(),
    ...(typeof raw.stream_type === 'string'
      ? { streamType: raw.stream_type as 'SNAPSHOT' | 'REALTIME' }
      : {}),
  };
}

function mapOrderbook(raw: Record<string, unknown>): CryptoRealtimeOrderbook | null {
  const market = parseMarket(raw.code);
  if (!market || !Array.isArray(raw.orderbook_units)) return null;
  return {
    exchange: 'UPBIT',
    market,
    timestamp: parseNumber(raw.timestamp),
    totalAskSize: decimalString(raw.total_ask_size),
    totalBidSize: decimalString(raw.total_bid_size),
    levels: raw.orderbook_units.filter(isRecord).map((level) => ({
      askPrice: decimalString(level.ask_price),
      askSize: decimalString(level.ask_size),
      bidPrice: decimalString(level.bid_price),
      bidSize: decimalString(level.bid_size),
    })),
    ...(raw.level !== undefined ? { level: decimalString(raw.level) } : {}),
    receivedAt: Date.now(),
    ...(typeof raw.stream_type === 'string'
      ? { streamType: raw.stream_type as 'SNAPSHOT' | 'REALTIME' }
      : {}),
  };
}

function mapCandle(
  raw: Record<string, unknown>,
  candleUnit: CryptoCandleUnit,
): CryptoRealtimeCandle | null {
  const market = parseMarket(raw.code);
  if (!market) return null;
  const utc = typeof raw.candle_date_time_utc === 'string' ? raw.candle_date_time_utc : '';
  const parsed = Date.parse(`${utc}Z`);
  const timestamp = parseNumber(raw.timestamp);
  return {
    exchange: 'UPBIT',
    market,
    unit: candleUnit,
    candleAt: Number.isFinite(parsed) ? parsed : timestamp,
    open: decimalString(raw.opening_price),
    high: decimalString(raw.high_price),
    low: decimalString(raw.low_price),
    close: decimalString(raw.trade_price),
    volume: decimalString(raw.candle_acc_trade_volume),
    tradePrice: decimalString(raw.candle_acc_trade_price),
    raw,
    receivedAt: Date.now(),
    ...(typeof raw.stream_type === 'string'
      ? { streamType: raw.stream_type as 'SNAPSHOT' | 'REALTIME' }
      : {}),
  };
}

function mapPrivateOrderEvent(
  accountId: number,
  raw: Record<string, unknown>,
): CryptoPrivateOrderEvent | null {
  const market = parseMarket(raw.code);
  const uuid = typeof raw.uuid === 'string' ? raw.uuid : null;
  if (!market || !uuid) return null;
  const timestamp = parseNumber(raw.timestamp);
  const side = raw.ask_bid === 'ASK' ? 'ask' : raw.ask_bid === 'BID' ? 'bid' : '';
  return {
    exchange: 'UPBIT',
    accountId,
    market,
    uuid,
    ...(typeof raw.identifier === 'string' ? { identifier: raw.identifier } : {}),
    side,
    ordType: typeof raw.order_type === 'string' ? raw.order_type : '',
    state: typeof raw.state === 'string' ? raw.state : 'wait',
    price: decimalString(raw.price),
    volume: decimalString(raw.volume),
    remainingVolume: decimalString(raw.remaining_volume),
    executedVolume: decimalString(raw.executed_volume),
    paidFee: decimalString(raw.paid_fee),
    locked: decimalString(raw.locked),
    ...(typeof raw.trade_uuid === 'string' ? { tradeUuid: raw.trade_uuid } : {}),
    ...(raw.trade_fee !== undefined ? { tradeFee: decimalString(raw.trade_fee) } : {}),
    ...(raw.executed_funds !== undefined
      ? { executedFunds: decimalString(raw.executed_funds) }
      : {}),
    orderTimestamp: parseNumber(raw.order_timestamp, timestamp),
    ...(raw.trade_timestamp !== undefined
      ? { tradeTimestamp: parseNumber(raw.trade_timestamp, timestamp) }
      : {}),
    timestamp,
    raw,
  };
}

function mapPrivateAssetEvent(
  accountId: number,
  raw: Record<string, unknown>,
): CryptoPrivateAssetEvent | null {
  if (!Array.isArray(raw.assets)) return null;
  const assets = raw.assets
    .filter(isRecord)
    .map((asset) => ({
      currency: typeof asset.currency === 'string' ? asset.currency : '',
      balance: decimalString(asset.balance),
      locked: decimalString(asset.locked),
    }))
    .filter((asset) => asset.currency.length > 0);
  if (assets.length === 0) return null;
  return {
    exchange: 'UPBIT',
    accountId,
    assets,
    timestamp: parseNumber(raw.timestamp ?? raw.asset_timestamp),
    raw,
  };
}
