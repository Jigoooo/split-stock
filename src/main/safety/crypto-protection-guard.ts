import { and, eq, gte, inArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { cryptoOrders, lots } from '../db/schema';
import type { ProtectionGuardError } from './protection-guard';
import type { ProtectionLimitsRepo } from './protection-limits-repo';
import { kstMidnightUtc } from './time-window';

const UPBIT_BROKER = 'UPBIT';

/**
 * 코인 자동매매 보호 한도 가드 — placeOrder 진입 전 검사. (RALPLAN P6 A3)
 *
 * stock ProtectionGuard 와 동일 정책을 cryptoOrders/lots 테이블 기반으로 적용.
 * protection_limits 테이블은 broker-agnostic (계좌 단위 1행) 이므로 그대로 재사용.
 *
 * 검사 순서:
 *   1. perSymbolDailyMaxBuys  — 오늘 해당 market 매수 주문 수 (state in 'wait','watch','done')
 *   2. dailyTotalMaxCount     — 오늘 전체 KRW 마켓 매수 주문 수
 *   3. dailyTotalMaxAmount    — 오늘 전체 매수 금액 합산 (price * volume 또는 price)
 *   4. accountTotalMaxAmount  — 현재 open lot 의 allocated_krw 총합
 *
 * NULL 한도는 "무제한" 처리 (skip).
 */
export class CryptoProtectionGuard {
  constructor(
    private readonly db: Db,
    private readonly limitsRepo: ProtectionLimitsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  canBuyToday(
    accountId: number,
    market: string,
    amountKrw: number,
  ): Result<void, ProtectionGuardError> {
    const limitsResult = this.limitsRepo.get(accountId);
    if (limitsResult.isErr()) return err({ kind: 'DB_ERROR', cause: limitsResult.error });

    const limits = limitsResult.value;
    if (!limits) return ok(undefined);

    const today = kstMidnightUtc(this.now());

    try {
      if (limits.perSymbolDailyMaxBuysEnabled && limits.perSymbolDailyMaxBuys !== null) {
        const rows = this.db
          .select({ id: cryptoOrders.id })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.market, market),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        const current = rows.length;
        if (current >= limits.perSymbolDailyMaxBuys) {
          return err({
            kind: 'LIMIT_PER_SYMBOL_DAILY_BUYS',
            current,
            max: limits.perSymbolDailyMaxBuys,
          });
        }
      }

      if (limits.dailyTotalMaxCountEnabled && limits.dailyTotalMaxCount !== null) {
        const rows = this.db
          .select({ id: cryptoOrders.id })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        const current = rows.length;
        if (current >= limits.dailyTotalMaxCount) {
          return err({
            kind: 'LIMIT_DAILY_TOTAL_COUNT',
            current,
            max: limits.dailyTotalMaxCount,
          });
        }
      }

      if (limits.dailyTotalMaxAmountEnabled && limits.dailyTotalMaxAmount !== null) {
        const rows = this.db
          .select({
            ordType: cryptoOrders.ordType,
            price: cryptoOrders.price,
            volume: cryptoOrders.volume,
          })
          .from(cryptoOrders)
          .where(
            and(
              eq(cryptoOrders.accountId, accountId),
              eq(cryptoOrders.side, 'bid'),
              gte(cryptoOrders.placedAt, today),
              inArray(cryptoOrders.state, ['wait', 'watch', 'done']),
            ),
          )
          .all();
        const currentKrw = rows.reduce((acc, row) => acc + sumOrderKrw(row), 0);
        if (currentKrw + amountKrw > limits.dailyTotalMaxAmount) {
          return err({
            kind: 'LIMIT_DAILY_TOTAL_AMOUNT',
            currentKrw,
            maxKrw: limits.dailyTotalMaxAmount,
          });
        }
      }

      if (limits.accountTotalMaxAmountEnabled && limits.accountTotalMaxAmount !== null) {
        const rows = this.db
          .select({ amountKrwDecimal: lots.amountKrwDecimal })
          .from(lots)
          .where(
            and(
              eq(lots.broker, UPBIT_BROKER),
              eq(lots.accountId, accountId),
              eq(lots.status, 'open'),
            ),
          )
          .all();
        const currentKrw = rows.reduce((acc, row) => acc + Number(row.amountKrwDecimal || '0'), 0);
        if (currentKrw + amountKrw > limits.accountTotalMaxAmount) {
          return err({
            kind: 'LIMIT_ACCOUNT_TOTAL_AMOUNT',
            currentKrw,
            maxKrw: limits.accountTotalMaxAmount,
          });
        }
      }

      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }
}

function sumOrderKrw(row: {
  ordType: string;
  price: string | null;
  volume: string | null;
}): number {
  if (row.ordType === 'price') return Number(row.price || '0');
  if (row.ordType === 'limit') return Number(row.price || '0') * Number(row.volume || '0');
  return 0;
}
