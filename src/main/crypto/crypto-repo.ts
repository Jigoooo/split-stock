import type {
  CryptoBalance,
  CryptoCandle,
  CryptoCandleUnit,
  CryptoExchangeId,
  CryptoMarketSummary,
  CryptoOrderDetail,
  CryptoOrderSnapshot,
  CryptoOrderTrade,
  CryptoPrivateAssetEvent,
  CryptoPrivateOrderEvent,
  CryptoRealtimeCheckpoint,
} from '@shared/contracts';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  cryptoBalances,
  cryptoCandles,
  cryptoFills,
  cryptoInstruments,
  cryptoOrders,
  cryptoRealtimeCheckpoints,
} from '../db/schema';
import { decimalAdd, decimalDiv, decimalMul } from './upbit/decimal';

interface PersistOrderInput {
  accountId: number;
  exchange: 'UPBIT';
  order: {
    uuid: string;
    identifier?: string;
    market: string;
    side: string;
    ord_type: string;
    state: string;
    price?: string;
    volume?: string;
    remaining_volume: string;
    executed_volume: string;
    paid_fee: string;
    locked: string;
    created_at: string;
  };
}

export class CryptoTradingRepo {
  constructor(private readonly db: Db) {}

  upsertMarkets(entries: CryptoMarketSummary[]): void {
    const now = new Date();
    this.db.transaction((tx) => {
      for (const entry of entries) {
        tx.insert(cryptoInstruments)
          .values({
            exchange: entry.exchange,
            market: entry.market,
            koreanName: entry.koreanName,
            englishName: entry.englishName,
            quoteCurrency: entry.quoteCurrency,
            baseCurrency: entry.baseCurrency,
            marketWarning: entry.marketWarning,
            rawJson: JSON.stringify(entry),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [cryptoInstruments.exchange, cryptoInstruments.market],
            set: {
              koreanName: entry.koreanName,
              englishName: entry.englishName,
              quoteCurrency: entry.quoteCurrency,
              baseCurrency: entry.baseCurrency,
              marketWarning: entry.marketWarning,
              rawJson: JSON.stringify(entry),
              updatedAt: now,
            },
          })
          .run();
      }
    });
  }

  upsertCandles(entries: CryptoCandle[]): void {
    if (entries.length === 0) return;
    const now = new Date();
    this.db.transaction((tx) => {
      for (const entry of entries) {
        tx.insert(cryptoCandles)
          .values({
            exchange: entry.exchange,
            market: entry.market,
            unit: entry.unit,
            candleAt: new Date(entry.candleAt),
            open: entry.open,
            high: entry.high,
            low: entry.low,
            close: entry.close,
            volume: entry.volume,
            tradePrice: entry.tradePrice,
            rawJson: entry.raw === undefined ? null : JSON.stringify(entry.raw),
            fetchedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              cryptoCandles.exchange,
              cryptoCandles.market,
              cryptoCandles.unit,
              cryptoCandles.candleAt,
            ],
            set: {
              open: entry.open,
              high: entry.high,
              low: entry.low,
              close: entry.close,
              volume: entry.volume,
              tradePrice: entry.tradePrice,
              rawJson: entry.raw === undefined ? null : JSON.stringify(entry.raw),
              fetchedAt: now,
            },
          })
          .run();
      }
    });
  }

  listCandlesBefore(input: {
    exchange: CryptoExchangeId;
    market: string;
    unit: CryptoCandleUnit;
    count?: number;
    toMs?: number;
  }): CryptoCandle[] {
    const count = Math.min(200, Math.max(1, Math.trunc(input.count ?? 200)));
    const base = [
      eq(cryptoCandles.exchange, input.exchange),
      eq(cryptoCandles.market, input.market),
      eq(cryptoCandles.unit, input.unit),
    ];
    const rows = this.db
      .select()
      .from(cryptoCandles)
      .where(
        and(
          ...base,
          ...(input.toMs !== undefined ? [lte(cryptoCandles.candleAt, new Date(input.toMs))] : []),
        ),
      )
      .orderBy(desc(cryptoCandles.candleAt))
      .limit(count)
      .all();
    return rows
      .map((row) => ({
        exchange: row.exchange as CryptoExchangeId,
        market: row.market,
        unit: row.unit as CryptoCandleUnit,
        candleAt: row.candleAt.getTime(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        tradePrice: row.tradePrice,
        raw: row.rawJson ? JSON.parse(row.rawJson) : undefined,
      }))
      .reverse();
  }

  upsertBalances(accountId: number, exchange: 'UPBIT', entries: CryptoBalance[]): void {
    const now = new Date();
    this.db.transaction((tx) => {
      for (const entry of entries) {
        tx.insert(cryptoBalances)
          .values({
            accountId,
            exchange,
            currency: entry.currency,
            balance: entry.balance,
            locked: entry.locked,
            avgBuyPrice: entry.avgBuyPrice,
            unitCurrency: entry.unitCurrency,
            rawJson: JSON.stringify(entry),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [cryptoBalances.accountId, cryptoBalances.exchange, cryptoBalances.currency],
            set: {
              balance: entry.balance,
              locked: entry.locked,
              avgBuyPrice: entry.avgBuyPrice,
              unitCurrency: entry.unitCurrency,
              rawJson: JSON.stringify(entry),
              updatedAt: now,
            },
          })
          .run();
      }
    });
  }

  upsertOrder(input: PersistOrderInput): void {
    const now = new Date();
    const placedAt = new Date(input.order.created_at);
    this.db
      .insert(cryptoOrders)
      .values({
        accountId: input.accountId,
        exchange: input.exchange,
        market: input.order.market,
        uuid: input.order.uuid,
        identifier: input.order.identifier ?? null,
        side: input.order.side,
        ordType: input.order.ord_type,
        state: input.order.state,
        price: input.order.price ?? null,
        volume: input.order.volume ?? null,
        remainingVolume: input.order.remaining_volume,
        executedVolume: input.order.executed_volume,
        paidFee: input.order.paid_fee,
        locked: input.order.locked,
        rawJson: JSON.stringify(input.order),
        placedAt: Number.isNaN(placedAt.getTime()) ? now : placedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cryptoOrders.accountId, cryptoOrders.uuid],
        set: {
          state: input.order.state,
          price: input.order.price ?? null,
          volume: input.order.volume ?? null,
          remainingVolume: input.order.remaining_volume,
          executedVolume: input.order.executed_volume,
          paidFee: input.order.paid_fee,
          locked: input.order.locked,
          rawJson: JSON.stringify(input.order),
          updatedAt: now,
        },
      })
      .run();
  }

  upsertOrderSnapshot(input: {
    accountId: number;
    exchange: CryptoExchangeId;
    order: CryptoOrderSnapshot;
  }): { fills: number } {
    const now = new Date();
    this.db
      .insert(cryptoOrders)
      .values({
        accountId: input.accountId,
        exchange: input.exchange,
        market: input.order.market,
        uuid: input.order.uuid,
        identifier: input.order.identifier ?? null,
        side: input.order.side,
        ordType: input.order.ordType,
        state: input.order.state,
        price: input.order.price ?? null,
        volume: input.order.volume ?? null,
        remainingVolume: input.order.remainingVolume,
        executedVolume: input.order.executedVolume,
        paidFee: input.order.paidFee,
        locked: input.order.locked,
        rawJson: JSON.stringify(input.order.raw ?? input.order),
        placedAt: new Date(input.order.placedAt),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cryptoOrders.accountId, cryptoOrders.uuid],
        set: {
          identifier: input.order.identifier ?? null,
          state: input.order.state,
          price: input.order.price ?? null,
          volume: input.order.volume ?? null,
          remainingVolume: input.order.remainingVolume,
          executedVolume: input.order.executedVolume,
          paidFee: input.order.paidFee,
          locked: input.order.locked,
          rawJson: JSON.stringify(input.order.raw ?? input.order),
          updatedAt: now,
        },
      })
      .run();

    let fills = 0;
    for (const trade of input.order.trades ?? []) {
      this.db
        .insert(cryptoFills)
        .values({
          accountId: input.accountId,
          exchange: input.exchange,
          orderUuid: input.order.uuid,
          tradeUuid: trade.uuid,
          market: input.order.market,
          side: input.order.side,
          price: trade.price,
          volume: trade.volume,
          funds: trade.funds,
          fee: trade.fee ?? '0',
          rawJson: JSON.stringify(trade.raw ?? trade),
          executedAt: new Date(trade.createdAt),
        })
        .onConflictDoUpdate({
          target: [cryptoFills.accountId, cryptoFills.tradeUuid],
          set: {
            price: trade.price,
            volume: trade.volume,
            funds: trade.funds,
            fee: trade.fee ?? '0',
            rawJson: JSON.stringify(trade.raw ?? trade),
            executedAt: new Date(trade.createdAt),
          },
        })
        .run();
      fills += 1;
    }

    return { fills };
  }

  applyPrivateOrderEvent(event: CryptoPrivateOrderEvent): void {
    this.upsertOrder({
      accountId: event.accountId,
      exchange: event.exchange,
      order: {
        uuid: event.uuid,
        market: event.market,
        side: event.side,
        ord_type: event.ordType,
        state: event.state === 'trade' ? 'wait' : event.state,
        price: event.price,
        volume: event.volume,
        remaining_volume: event.remainingVolume,
        executed_volume: event.executedVolume,
        paid_fee: event.paidFee,
        locked: event.locked,
        created_at: new Date(event.orderTimestamp).toISOString(),
        ...(event.identifier !== undefined && event.identifier !== null
          ? { identifier: event.identifier }
          : {}),
      },
    });

    if (event.state !== 'trade' || !event.tradeUuid) return;
    this.db
      .insert(cryptoFills)
      .values({
        accountId: event.accountId,
        exchange: event.exchange,
        orderUuid: event.uuid,
        tradeUuid: event.tradeUuid,
        market: event.market,
        side: event.side,
        price: event.price,
        volume: event.volume,
        funds: event.executedFunds ?? '0',
        fee: event.tradeFee ?? '0',
        rawJson: event.raw === undefined ? null : JSON.stringify(event.raw),
        executedAt: new Date(event.tradeTimestamp ?? event.timestamp),
      })
      .onConflictDoUpdate({
        target: [cryptoFills.accountId, cryptoFills.tradeUuid],
        set: {
          price: event.price,
          volume: event.volume,
          funds: event.executedFunds ?? '0',
          fee: event.tradeFee ?? '0',
          rawJson: event.raw === undefined ? null : JSON.stringify(event.raw),
          executedAt: new Date(event.tradeTimestamp ?? event.timestamp),
        },
      })
      .run();
  }

  applyPrivateAssetEvent(event: CryptoPrivateAssetEvent): void {
    const now = new Date();
    this.db.transaction((tx) => {
      for (const asset of event.assets) {
        tx.insert(cryptoBalances)
          .values({
            accountId: event.accountId,
            exchange: event.exchange,
            currency: asset.currency,
            balance: asset.balance,
            locked: asset.locked,
            avgBuyPrice: '0',
            unitCurrency: 'KRW',
            rawJson: event.raw === undefined ? null : JSON.stringify(event.raw),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [cryptoBalances.accountId, cryptoBalances.exchange, cryptoBalances.currency],
            set: {
              balance: asset.balance,
              locked: asset.locked,
              rawJson: event.raw === undefined ? null : JSON.stringify(event.raw),
              updatedAt: now,
            },
          })
          .run();
      }
    });
  }

  listRecentOrders(accountId: number, limit = 100) {
    return this.db
      .select()
      .from(cryptoOrders)
      .where(eq(cryptoOrders.accountId, accountId))
      .orderBy(desc(cryptoOrders.updatedAt))
      .limit(limit)
      .all();
  }

  getOrderDetail(accountId: number, uuid: string): CryptoOrderDetail | null {
    const row = this.db
      .select()
      .from(cryptoOrders)
      .where(and(eq(cryptoOrders.accountId, accountId), eq(cryptoOrders.uuid, uuid)))
      .get();
    if (!row?.uuid) return null;

    const fills = this.db
      .select()
      .from(cryptoFills)
      .where(and(eq(cryptoFills.accountId, accountId), eq(cryptoFills.orderUuid, row.uuid)))
      .orderBy(desc(cryptoFills.executedAt))
      .all()
      .reverse();
    const trades: CryptoOrderTrade[] = fills.map((fill) => ({
      uuid: fill.tradeUuid ?? `${row.uuid}:${fill.id}`,
      market: fill.market,
      side: fill.side,
      price: fill.price,
      volume: fill.volume,
      funds: fill.funds,
      fee: fill.fee,
      createdAt: fill.executedAt.getTime(),
      raw: fill.rawJson ? JSON.parse(fill.rawJson) : undefined,
    }));
    const totalExecutedFunds = trades.reduce((sum, trade) => decimalAdd(sum, trade.funds), '0');
    const totalFee =
      trades.length > 0
        ? trades.reduce((sum, trade) => decimalAdd(sum, trade.fee ?? '0'), '0')
        : row.paidFee;
    const executedVolume =
      row.executedVolume !== '0'
        ? row.executedVolume
        : trades.reduce((sum, trade) => decimalAdd(sum, trade.volume), '0');
    const fallbackExecutedFunds =
      row.price && row.executedVolume ? decimalMul(row.price, row.executedVolume) : '0';
    const normalizedExecutedFunds =
      totalExecutedFunds !== '0' || trades.length > 0 ? totalExecutedFunds : fallbackExecutedFunds;
    const averageExecutedPrice =
      executedVolume === '0' ? '0' : decimalDiv(normalizedExecutedFunds, executedVolume, 12);

    return {
      accountId,
      exchange: row.exchange as CryptoOrderDetail['exchange'],
      uuid: row.uuid,
      ...(row.identifier !== null ? { identifier: row.identifier } : {}),
      market: row.market as CryptoOrderDetail['market'],
      side: row.side,
      ordType: row.ordType,
      state: row.state,
      ...(row.price !== null ? { price: row.price } : {}),
      ...(row.volume !== null ? { volume: row.volume } : {}),
      remainingVolume: row.remainingVolume,
      executedVolume,
      paidFee: row.paidFee,
      locked: row.locked,
      placedAt: row.placedAt.getTime(),
      trades,
      raw: row.rawJson ? JSON.parse(row.rawJson) : undefined,
      averageExecutedPrice,
      totalExecutedFunds: normalizedExecutedFunds,
      totalFee,
      fillCount: trades.length,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  listFills(accountId: number, limit = 100) {
    return this.db
      .select()
      .from(cryptoFills)
      .where(eq(cryptoFills.accountId, accountId))
      .orderBy(desc(cryptoFills.executedAt))
      .limit(limit)
      .all();
  }

  getRealtimeCheckpoint(input: {
    accountId: number;
    exchange: CryptoExchangeId;
    stream: string;
  }): CryptoRealtimeCheckpoint | null {
    const row = this.db
      .select()
      .from(cryptoRealtimeCheckpoints)
      .where(
        and(
          eq(cryptoRealtimeCheckpoints.accountId, input.accountId),
          eq(cryptoRealtimeCheckpoints.exchange, input.exchange),
          eq(cryptoRealtimeCheckpoints.stream, input.stream),
        ),
      )
      .get();
    if (!row) return null;
    return {
      accountId: row.accountId,
      exchange: row.exchange as CryptoExchangeId,
      stream: row.stream,
      lastEventAt: row.lastEventAt.getTime(),
      cursor: row.cursorJson ? JSON.parse(row.cursorJson) : null,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  upsertRealtimeCheckpoint(input: {
    accountId: number;
    exchange: CryptoExchangeId;
    stream: string;
    lastEventAt: number;
    cursor?: unknown;
  }): void {
    const now = new Date();
    this.db
      .insert(cryptoRealtimeCheckpoints)
      .values({
        accountId: input.accountId,
        exchange: input.exchange,
        stream: input.stream,
        lastEventAt: new Date(input.lastEventAt),
        cursorJson: input.cursor === undefined ? null : JSON.stringify(input.cursor),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cryptoRealtimeCheckpoints.accountId,
          cryptoRealtimeCheckpoints.exchange,
          cryptoRealtimeCheckpoints.stream,
        ],
        set: {
          lastEventAt: new Date(input.lastEventAt),
          cursorJson: input.cursor === undefined ? null : JSON.stringify(input.cursor),
          updatedAt: now,
        },
      })
      .run();
  }
}
