import {
  type CryptoBalance,
  type CryptoMarketSummary,
  type CryptoOrderbook,
  type CryptoOrderIntent,
  CryptoOrderIntentSchema,
  type CryptoTicker,
} from '@shared/contracts';
import Upbit from '@upbit-official/upbit-sdk';
import { err, ok, type Result } from 'neverthrow';
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

export interface UpbitExchangeAdapterOptions {
  accessKey?: string;
  secretKey?: string;
  client?: Upbit;
  limiter?: UpbitRateLimiter;
}

export class UpbitExchangeAdapter {
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
