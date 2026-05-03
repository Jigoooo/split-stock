import {
  type CryptoBalance,
  type CryptoCandle,
  type CryptoCandleUnit,
  type CryptoMarketSummary,
  type CryptoOrderbook,
  type CryptoOrderbookInstrument,
  type CryptoOrderIntent,
  CryptoOrderIntentSchema,
  type CryptoOrderSnapshot,
  type CryptoOrderTrade,
  type CryptoTicker,
  type CryptoTransferStatus,
  type CryptoWalletStatus,
} from '@shared/contracts';
import Upbit from '@upbit-official/upbit-sdk';
import { err, ok, type Result } from 'neverthrow';
import type { CryptoMarketDataAdapter } from '../ports';
import { decimalGte, decimalMul, decimalString } from './decimal';
import { toUpbitExchangeError } from './errors';
import { sharedUpbitRateLimiter, type UpbitRateLimiter } from './rate-limiter';

type UpbitOrder = {
  uuid: string;
  side: 'bid' | 'ask';
  ord_type: 'limit' | 'price' | 'market' | 'best';
  state: 'wait' | 'watch' | 'done' | 'cancel';
  market: string;
  created_at: string;
  volume?: string;
  remaining_volume: string;
  executed_volume: string;
  price?: string;
  paid_fee: string;
  locked: string;
  identifier?: string;
  trades_count?: number;
  trades?: Array<{
    uuid?: string;
    market?: string;
    side?: string;
    price?: string;
    volume?: string;
    funds?: string;
    fee?: string;
    created_at?: string;
  }>;
};

type UpbitChance = {
  bid_account: { balance: string; locked: string; currency: string };
  ask_account: { balance: string; locked: string; currency: string };
  market: {
    id: string;
    bid: { min_total: string; currency: string };
    ask: { min_total: string; currency: string };
    bid_types: string[];
    ask_types: string[];
    state: string;
  };
};

type UpbitCandle = {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst?: string;
  opening_price: string;
  high_price: string;
  low_price: string;
  trade_price: string;
  candle_acc_trade_volume: string;
  candle_acc_trade_price: string;
  timestamp: number;
};

type UpbitDeposit = {
  uuid: string;
  currency: string;
  amount: string;
  fee: string;
  state: string;
  txid?: string | null;
  transaction_type: string;
  type: string;
  net_type?: string | null;
  created_at: string;
  done_at?: string | null;
};

type UpbitWithdraw = {
  uuid: string;
  currency: string;
  amount: string;
  fee: string;
  state: string;
  txid?: string | null;
  transaction_type: string;
  type: string;
  net_type?: string | null;
  created_at: string;
  done_at?: string | null;
  is_cancelable?: boolean | null;
};

type UpbitWalletStatus = {
  currency: string;
  net_type: string;
  network_name: string;
  wallet_state: string;
  block_elapsed_minutes?: number | null;
  block_height?: number | null;
  block_state?: string | null;
  block_updated_at?: string | null;
};

const MINUTE_UNITS = new Set<CryptoCandleUnit>([
  '1m',
  '3m',
  '5m',
  '10m',
  '15m',
  '30m',
  '60m',
  '240m',
]);

type UpbitMinuteUnit = 1 | 3 | 5 | 10 | 15 | 30 | 60 | 240;

export interface UpbitExchangeAdapterOptions {
  accessKey?: string;
  secretKey?: string;
  client?: Upbit;
  limiter?: UpbitRateLimiter;
}

export class UpbitExchangeAdapter implements CryptoMarketDataAdapter {
  readonly exchangeId = 'UPBIT' as const;
  private readonly client: Upbit;
  private readonly limiter: UpbitRateLimiter;

  constructor(options: UpbitExchangeAdapterOptions = {}) {
    this.client =
      options.client ??
      new Upbit({
        accessKey: options.accessKey ?? null,
        secretKey: options.secretKey ?? null,
        environment: 'kr',
      });
    this.limiter = options.limiter ?? sharedUpbitRateLimiter;
  }

  async listMarkets(): Promise<
    Result<CryptoMarketSummary[], ReturnType<typeof toUpbitExchangeError>>
  > {
    try {
      const rows = await this.limiter.schedule('market', () =>
        this.client.tradingPairs.list({ is_details: true }),
      );
      return ok(
        rows.map((row) => {
          const [quoteCurrency = '', baseCurrency = ''] = row.market.split('-');
          return {
            exchange: 'UPBIT',
            market: row.market,
            koreanName: row.korean_name,
            englishName: row.english_name,
            quoteCurrency,
            baseCurrency,
            marketWarning: row.market_warning ?? 'NONE',
          };
        }),
      );
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getCandles(input: {
    market: string;
    unit: CryptoCandleUnit;
    count?: number;
    toMs?: number;
  }): Promise<Result<CryptoCandle[], ReturnType<typeof toUpbitExchangeError>>> {
    const count = clampCount(input.count ?? 200);
    const query = {
      market: input.market,
      count,
      ...(input.toMs !== undefined ? { to: new Date(input.toMs).toISOString() } : {}),
    };

    try {
      const rows = await this.limiter.schedule('candle', async () => {
        if (MINUTE_UNITS.has(input.unit)) {
          return this.client.candles.listMinutes(minuteUnit(input.unit), query);
        }
        if (input.unit === 'D') return this.client.candles.listDays(query);
        if (input.unit === 'W') return this.client.candles.listWeeks(query);
        return this.client.candles.listMonths(query);
      });
      return ok(
        rows
          .map((row) => mapCandle(row as UpbitCandle, input.unit))
          .filter((candle): candle is CryptoCandle => candle !== null)
          .sort((a, b) => a.candleAt - b.candleAt),
      );
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getTicker(
    market: string,
  ): Promise<Result<CryptoTicker, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const rows = await this.limiter.schedule('ticker', () =>
        this.client.tickers.listByTradingPairs({ markets: market }),
      );
      const ticker = rows[0];
      if (!ticker) {
        return err({
          exchangeId: 'UPBIT',
          kind: 'NOT_FOUND',
          message: `ticker not found: ${market}`,
        });
      }
      return ok({
        market: ticker.market,
        tradePrice: decimalString(ticker.trade_price),
        openingPrice: decimalString(ticker.opening_price),
        highPrice: decimalString(ticker.high_price),
        lowPrice: decimalString(ticker.low_price),
        signedChangePrice: decimalString(ticker.signed_change_price),
        signedChangeRate: decimalString(ticker.signed_change_rate),
        accTradePrice24h: decimalString(ticker.acc_trade_price_24h),
        accTradeVolume24h: decimalString(ticker.acc_trade_volume_24h),
        timestamp: ticker.timestamp,
      });
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getOrderbookInstruments(
    markets: string[],
  ): Promise<Result<CryptoOrderbookInstrument[], ReturnType<typeof toUpbitExchangeError>>> {
    if (markets.length === 0) return ok([]);
    try {
      const rows = await this.limiter.schedule('orderbook', () =>
        this.client.orderbooks.listInstruments({ markets: Array.from(new Set(markets)).join(',') }),
      );
      return ok(
        rows.map((row) => ({
          exchange: 'UPBIT',
          market: row.market,
          quoteCurrency: row.quote_currency,
          tickSize: decimalString(row.tick_size),
          supportedLevels: row.supported_levels.map((level) => decimalString(level)),
        })),
      );
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getOrderbook(
    market: string,
    count = 30,
  ): Promise<Result<CryptoOrderbook, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const rows = await this.limiter.schedule('orderbook', () =>
        this.client.orderbooks.list({ markets: market, count }),
      );
      const orderbook = rows[0];
      if (!orderbook) {
        return err({
          exchangeId: 'UPBIT',
          kind: 'NOT_FOUND',
          message: `orderbook not found: ${market}`,
        });
      }
      return ok({
        market: orderbook.market,
        timestamp: orderbook.timestamp,
        totalAskSize: decimalString(orderbook.total_ask_size),
        totalBidSize: decimalString(orderbook.total_bid_size),
        levels: orderbook.orderbook_units.map((level) => ({
          askPrice: decimalString(level.ask_price),
          askSize: decimalString(level.ask_size),
          bidPrice: decimalString(level.bid_price),
          bidSize: decimalString(level.bid_size),
        })),
      });
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listBalances(): Promise<Result<CryptoBalance[], ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const rows = await this.limiter.schedule('exchange-default', () =>
        this.client.accounts.list(),
      );
      return ok(
        rows.map((row) => ({
          currency: row.currency,
          balance: decimalString(row.balance),
          locked: decimalString(row.locked),
          avgBuyPrice: decimalString(row.avg_buy_price),
          unitCurrency: row.unit_currency,
        })),
      );
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getOrder(input: {
    uuid?: string;
    identifier?: string;
  }): Promise<Result<CryptoOrderSnapshot, ReturnType<typeof toUpbitExchangeError>>> {
    if (!input.uuid && !input.identifier) {
      return err({
        exchangeId: 'UPBIT',
        kind: 'VALIDATION',
        message: 'uuid 또는 identifier가 필요합니다.',
      });
    }

    try {
      const order = await this.limiter.schedule('order', () => this.client.orders.retrieve(input));
      return ok(mapOrderSnapshot(order as UpbitOrder));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listOpenOrders(
    input: { market?: string; limit?: number } = {},
  ): Promise<Result<CryptoOrderSnapshot[], ReturnType<typeof toUpbitExchangeError>>> {
    const limit = clampListLimit(input.limit ?? 200);
    try {
      const rows = await this.limiter.schedule('order', async () => {
        const collected: UpbitOrder[] = [];
        for await (const order of this.client.orders.listOpen({
          ...(input.market !== undefined ? { market: input.market } : {}),
          states: ['wait', 'watch'],
          order_by: 'desc',
        })) {
          collected.push(order as UpbitOrder);
          if (collected.length >= limit) break;
        }
        return collected;
      });
      return ok(rows.map(mapOrderSnapshot));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listClosedOrders(
    input: { market?: string; startTimeMs?: number; endTimeMs?: number; limit?: number } = {},
  ): Promise<Result<CryptoOrderSnapshot[], ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const rows = await this.limiter.schedule('order', () =>
        this.client.orders.listClosed({
          ...(input.market !== undefined ? { market: input.market } : {}),
          ...(input.startTimeMs !== undefined
            ? { start_time: new Date(input.startTimeMs).toISOString() }
            : {}),
          ...(input.endTimeMs !== undefined
            ? { end_time: new Date(input.endTimeMs).toISOString() }
            : {}),
          limit: clampListLimit(input.limit ?? 200),
          order_by: 'desc',
          states: ['done', 'cancel'],
        }),
      );
      return ok((rows as UpbitOrder[]).map(mapOrderSnapshot));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listDeposits(
    input: { currency?: string; state?: string; limit?: number } = {},
  ): Promise<Result<CryptoTransferStatus[], ReturnType<typeof toUpbitExchangeError>>> {
    const limit = clampListLimit(input.limit ?? 100);
    try {
      const rows = await this.limiter.schedule('exchange-default', async () => {
        const collected: UpbitDeposit[] = [];
        for await (const deposit of this.client.deposits.list({
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.state !== undefined ? { state: input.state as never } : {}),
          order_by: 'desc',
        })) {
          collected.push(deposit as UpbitDeposit);
          if (collected.length >= limit) break;
        }
        return collected;
      });
      return ok(rows.map(mapDepositStatus));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getDeposit(input: {
    uuid?: string;
    txid?: string;
    currency?: string;
  }): Promise<Result<CryptoTransferStatus, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const row = await this.limiter.schedule('exchange-default', () =>
        this.client.deposits.retrieve(input),
      );
      return ok(mapDepositStatus(row as UpbitDeposit));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listWithdrawals(
    input: { currency?: string; state?: string; limit?: number } = {},
  ): Promise<Result<CryptoTransferStatus[], ReturnType<typeof toUpbitExchangeError>>> {
    const limit = clampListLimit(input.limit ?? 100);
    try {
      const rows = await this.limiter.schedule('exchange-default', async () => {
        const collected: UpbitWithdraw[] = [];
        for await (const withdraw of this.client.withdraws.list({
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.state !== undefined ? { state: input.state as never } : {}),
          order_by: 'desc',
        })) {
          collected.push(withdraw as UpbitWithdraw);
          if (collected.length >= limit) break;
        }
        return collected;
      });
      return ok(rows.map(mapWithdrawStatus));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getWithdrawal(input: {
    uuid?: string;
    txid?: string;
    currency?: string;
  }): Promise<Result<CryptoTransferStatus, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const row = await this.limiter.schedule('exchange-default', () =>
        this.client.withdraws.retrieve(input),
      );
      return ok(mapWithdrawStatus(row as UpbitWithdraw));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async listWalletStatuses(): Promise<
    Result<CryptoWalletStatus[], ReturnType<typeof toUpbitExchangeError>>
  > {
    try {
      const rows = await this.limiter.schedule('exchange-default', () =>
        this.client.walletStatus.list(),
      );
      return ok((rows as UpbitWalletStatus[]).map(mapWalletStatus));
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async getOrderChance(
    market: string,
  ): Promise<Result<UpbitChance, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const chance = await this.limiter.schedule('exchange-default', () =>
        this.client.orders.retrieveChance({ market }),
      );
      return ok(chance as UpbitChance);
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async createOrder(
    intent: CryptoOrderIntent,
  ): Promise<Result<UpbitOrder, ReturnType<typeof toUpbitExchangeError>>> {
    const parsed = CryptoOrderIntentSchema.safeParse(intent);
    if (!parsed.success) {
      return err({
        exchangeId: 'UPBIT',
        kind: 'VALIDATION',
        message: parsed.error.issues.map((issue) => issue.message).join(', '),
        raw: parsed.error.flatten(),
      });
    }

    const chance = await this.getOrderChance(parsed.data.market);
    if (chance.isErr()) return err(chance.error);
    const validation = validateAgainstChance(parsed.data, chance.value);
    if (validation) return err(validation);

    try {
      const order = await this.limiter.schedule('order', () =>
        this.client.orders.create({
          market: parsed.data.market,
          side: parsed.data.side,
          ord_type: parsed.data.ordType,
          ...(parsed.data.price !== undefined && { price: parsed.data.price }),
          ...(parsed.data.volume !== undefined && { volume: parsed.data.volume }),
          ...(parsed.data.timeInForce !== undefined && { time_in_force: parsed.data.timeInForce }),
          ...(parsed.data.smpType !== undefined && { smp_type: parsed.data.smpType }),
          ...(parsed.data.identifier !== undefined && { identifier: parsed.data.identifier }),
        }),
      );
      return ok(order as UpbitOrder);
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }

  async cancelOrder(input: {
    uuid?: string;
    identifier?: string;
  }): Promise<Result<UpbitOrder, ReturnType<typeof toUpbitExchangeError>>> {
    try {
      const order = await this.limiter.schedule('exchange-default', () =>
        this.client.orders.cancel(input),
      );
      return ok(order as UpbitOrder);
    } catch (cause) {
      return err(toUpbitExchangeError(cause));
    }
  }
}

function validateAgainstChance(
  intent: CryptoOrderIntent,
  chance: UpbitChance,
): ReturnType<typeof toUpbitExchangeError> | null {
  if (chance.market.state !== 'active') {
    return { exchangeId: 'UPBIT', kind: 'BUSINESS', message: '거래 가능한 마켓 상태가 아닙니다.' };
  }
  const sideTypes = intent.side === 'bid' ? chance.market.bid_types : chance.market.ask_types;
  if (!sideTypes.includes(intent.ordType)) {
    return {
      exchangeId: 'UPBIT',
      kind: 'VALIDATION',
      message: `지원하지 않는 주문 유형입니다: ${intent.ordType}`,
      raw: { supported: sideTypes },
    };
  }

  const minTotal =
    intent.side === 'bid' ? chance.market.bid.min_total : chance.market.ask.min_total;
  const total =
    intent.ordType === 'price' || (intent.ordType === 'best' && intent.side === 'bid')
      ? intent.price
      : intent.price && intent.volume
        ? decimalMul(intent.price, intent.volume)
        : undefined;
  if (total !== undefined && !decimalGte(total, minTotal)) {
    return {
      exchangeId: 'UPBIT',
      kind: 'BUSINESS',
      message: `최소 주문금액(${minTotal}) 미만입니다.`,
      raw: { total, minTotal },
    };
  }

  if (intent.side === 'bid') {
    const needed = total ?? intent.price ?? '0';
    if (!decimalGte(chance.bid_account.balance, needed)) {
      return { exchangeId: 'UPBIT', kind: 'BUSINESS', message: '매수 가능 잔고가 부족합니다.' };
    }
  } else if (intent.volume && !decimalGte(chance.ask_account.balance, intent.volume)) {
    return { exchangeId: 'UPBIT', kind: 'BUSINESS', message: '매도 가능 수량이 부족합니다.' };
  }

  return null;
}

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 200;
  return Math.min(200, Math.max(1, Math.trunc(count)));
}

function clampListLimit(count: number): number {
  if (!Number.isFinite(count)) return 200;
  return Math.min(1000, Math.max(1, Math.trunc(count)));
}

function minuteUnit(unit: CryptoCandleUnit): UpbitMinuteUnit {
  const numeric = Number(unit.slice(0, -1));
  if (
    numeric === 1 ||
    numeric === 3 ||
    numeric === 5 ||
    numeric === 10 ||
    numeric === 15 ||
    numeric === 30 ||
    numeric === 60 ||
    numeric === 240
  ) {
    return numeric;
  }
  return 1;
}

function parseCandleAt(row: UpbitCandle): number {
  const parsed = Date.parse(`${row.candle_date_time_utc}Z`);
  if (Number.isFinite(parsed)) return parsed;
  return Number.isFinite(row.timestamp) ? row.timestamp : Date.now();
}

function mapCandle(row: UpbitCandle, unit: CryptoCandleUnit): CryptoCandle | null {
  if (!row.market) return null;
  return {
    exchange: 'UPBIT',
    market: row.market,
    unit,
    candleAt: parseCandleAt(row),
    open: decimalString(row.opening_price),
    high: decimalString(row.high_price),
    low: decimalString(row.low_price),
    close: decimalString(row.trade_price),
    volume: decimalString(row.candle_acc_trade_volume),
    tradePrice: decimalString(row.candle_acc_trade_price),
    raw: row,
  };
}

function parseDateMs(value: string | undefined, fallback = Date.now()): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapOrderTrade(row: NonNullable<UpbitOrder['trades']>[number]): CryptoOrderTrade | null {
  if (!row.uuid) return null;
  return {
    uuid: row.uuid,
    ...(row.market !== undefined ? { market: row.market } : {}),
    ...(row.side !== undefined ? { side: row.side } : {}),
    price: decimalString(row.price),
    volume: decimalString(row.volume),
    funds: decimalString(row.funds),
    ...(row.fee !== undefined ? { fee: decimalString(row.fee) } : {}),
    createdAt: parseDateMs(row.created_at),
    raw: row,
  };
}

function mapOrderSnapshot(row: UpbitOrder): CryptoOrderSnapshot {
  const trades = row.trades
    ?.map(mapOrderTrade)
    .filter((trade): trade is CryptoOrderTrade => trade !== null);
  return {
    uuid: row.uuid,
    ...(row.identifier !== undefined ? { identifier: row.identifier } : {}),
    market: row.market,
    side: row.side,
    ordType: row.ord_type,
    state: row.state,
    ...(row.price !== undefined ? { price: decimalString(row.price) } : {}),
    ...(row.volume !== undefined ? { volume: decimalString(row.volume) } : {}),
    remainingVolume: decimalString(row.remaining_volume),
    executedVolume: decimalString(row.executed_volume),
    paidFee: decimalString(row.paid_fee),
    locked: decimalString(row.locked),
    placedAt: parseDateMs(row.created_at),
    ...(trades && trades.length > 0 ? { trades } : {}),
    raw: row,
  };
}

function mapDepositStatus(row: UpbitDeposit): CryptoTransferStatus {
  return {
    direction: 'deposit',
    uuid: row.uuid,
    currency: row.currency,
    amount: decimalString(row.amount),
    fee: decimalString(row.fee),
    state: row.state,
    txid: row.txid ?? null,
    transactionType: row.transaction_type,
    transferType: row.type,
    netType: row.net_type ?? null,
    createdAt: parseDateMs(row.created_at),
    doneAt: row.done_at ? parseDateMs(row.done_at) : null,
    raw: row,
  };
}

function mapWithdrawStatus(row: UpbitWithdraw): CryptoTransferStatus {
  return {
    direction: 'withdraw',
    uuid: row.uuid,
    currency: row.currency,
    amount: decimalString(row.amount),
    fee: decimalString(row.fee),
    state: row.state,
    txid: row.txid ?? null,
    transactionType: row.transaction_type,
    transferType: row.type,
    netType: row.net_type ?? null,
    createdAt: parseDateMs(row.created_at),
    doneAt: row.done_at ? parseDateMs(row.done_at) : null,
    isCancelable: row.is_cancelable ?? null,
    raw: row,
  };
}

function mapWalletStatus(row: UpbitWalletStatus): CryptoWalletStatus {
  return {
    currency: row.currency,
    netType: row.net_type,
    networkName: row.network_name,
    walletState: row.wallet_state,
    blockElapsedMinutes: row.block_elapsed_minutes ?? null,
    blockHeight: row.block_height ?? null,
    blockState: row.block_state ?? null,
    blockUpdatedAt: row.block_updated_at ? parseDateMs(row.block_updated_at) : null,
    raw: row,
  };
}
