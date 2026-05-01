import type {
  CryptoBalance,
  CryptoCandle,
  CryptoCandleUnit,
  CryptoExchangeError,
  CryptoMarketSummary,
  CryptoOrderbook,
  CryptoOrderbookInstrument,
  CryptoOrderSnapshot,
  CryptoPrivateAssetEvent,
  CryptoPrivateOrderEvent,
  CryptoRealtimeCandle,
  CryptoRealtimeOrderbook,
  CryptoRealtimeTicker,
  CryptoRealtimeTrade,
  CryptoTicker,
} from '@shared/contracts';
import type { Result } from 'neverthrow';

export interface CryptoMarketDataAdapter {
  readonly exchangeId: 'UPBIT';
  listMarkets(): Promise<Result<CryptoMarketSummary[], CryptoExchangeError>>;
  getTicker(market: string): Promise<Result<CryptoTicker, CryptoExchangeError>>;
  getOrderbook(
    market: string,
    count?: number,
  ): Promise<Result<CryptoOrderbook, CryptoExchangeError>>;
  getOrderbookInstruments(
    markets: string[],
  ): Promise<Result<CryptoOrderbookInstrument[], CryptoExchangeError>>;
  getCandles(input: {
    market: string;
    unit: CryptoCandleUnit;
    count?: number;
    toMs?: number;
  }): Promise<Result<CryptoCandle[], CryptoExchangeError>>;
  listBalances(): Promise<Result<CryptoBalance[], CryptoExchangeError>>;
  getOrder(input: {
    uuid?: string;
    identifier?: string;
  }): Promise<Result<CryptoOrderSnapshot, CryptoExchangeError>>;
  listOpenOrders(input?: {
    market?: string;
    limit?: number;
  }): Promise<Result<CryptoOrderSnapshot[], CryptoExchangeError>>;
  listClosedOrders(input?: {
    market?: string;
    startTimeMs?: number;
    endTimeMs?: number;
    limit?: number;
  }): Promise<Result<CryptoOrderSnapshot[], CryptoExchangeError>>;
}

export type CryptoPublicRealtimeEvent =
  | { kind: 'ticker'; value: CryptoRealtimeTicker }
  | { kind: 'trade'; value: CryptoRealtimeTrade }
  | { kind: 'orderbook'; value: CryptoRealtimeOrderbook }
  | { kind: 'candle'; value: CryptoRealtimeCandle };

export interface CryptoRealtimeAdapter {
  watchPublic(input: {
    market: string;
    candleUnit: CryptoCandleUnit;
    onEvent: (event: CryptoPublicRealtimeEvent) => void;
    onError?: (cause: unknown) => void;
  }): { close(): void };
  watchPrivate(input: {
    accountId: number;
    markets?: string[];
    onOrder: (event: CryptoPrivateOrderEvent) => void;
    onAsset: (event: CryptoPrivateAssetEvent) => void;
    onError?: (cause: unknown) => void;
  }): { close(): void };
}
