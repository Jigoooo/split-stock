import type { CryptoBalance, CryptoMarketSummary } from '@shared/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { cryptoBalances, cryptoInstruments, cryptoOrders } from '../db/schema';

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

  listRecentOrders(accountId: number, limit = 100) {
    return this.db
      .select()
      .from(cryptoOrders)
      .where(eq(cryptoOrders.accountId, accountId))
      .orderBy(desc(cryptoOrders.updatedAt))
      .limit(limit)
      .all();
  }
}
