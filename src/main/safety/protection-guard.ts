import { and, eq, gte, inArray, sum } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { lots, orders } from '../db/schema';
import type { ProtectionLimitsRepo } from './protection-limits-repo';
import { kstMidnightUtc } from './time-window';

export type ProtectionGuardError =
  | { kind: 'LIMIT_PER_SYMBOL_DAILY_BUYS'; current: number; max: number }
  | { kind: 'LIMIT_DAILY_TOTAL_COUNT'; current: number; max: number }
  | { kind: 'LIMIT_DAILY_TOTAL_AMOUNT'; currentKrw: number; maxKrw: number }
  | { kind: 'LIMIT_ACCOUNT_TOTAL_AMOUNT'; currentKrw: number; maxKrw: number }
  | { kind: 'DB_ERROR'; cause: unknown };

/**
 * 자동매매 보호 한도 가드 — placeCash 진입 전 검사.
 *
 * 검사 순서:
 *   1. perSymbolDailyMaxBuys  — 오늘 종목별 매수 주문 수 (PENDING/PARTIAL 포함)
 *   2. dailyTotalMaxCount     — 오늘 전체 계좌 매수 주문 수
 *   3. dailyTotalMaxAmount    — 오늘 전체 계좌 매수 금액 합산
 *   4. accountTotalMaxAmount  — 현재 오픈 포지션 총액 (OPEN 차수)
 *
 * NULL 한도는 "무제한"으로 처리 (skip).
 * `now` 주입으로 테스트 가능.
 */
export class ProtectionGuard {
  constructor(
    private readonly db: Db,
    private readonly limitsRepo: ProtectionLimitsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  canBuyToday(
    accountId: number,
    pdno: string,
    amountKrw: number,
  ): Result<void, ProtectionGuardError> {
    const limitsResult = this.limitsRepo.get(accountId);
    if (limitsResult.isErr()) return err({ kind: 'DB_ERROR', cause: limitsResult.error });

    const limits = limitsResult.value;
    // 한도 설정 없으면 즉시 통과
    if (!limits) return ok(undefined);

    const today = kstMidnightUtc(this.now());

    try {
      // 1. 종목별 일일 매수 횟수
      if (limits.perSymbolDailyMaxBuysEnabled && limits.perSymbolDailyMaxBuys !== null) {
        const symbolBuys = this.db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.accountId, accountId),
              eq(orders.pdno, pdno),
              eq(orders.side, 'BUY'),
              gte(orders.placedAt, today),
              inArray(orders.status, ['PENDING', 'PARTIAL', 'FILLED']),
            ),
          )
          .all();
        const current = symbolBuys.length;
        if (current >= limits.perSymbolDailyMaxBuys) {
          return err({
            kind: 'LIMIT_PER_SYMBOL_DAILY_BUYS',
            current,
            max: limits.perSymbolDailyMaxBuys,
          });
        }
      }

      // 2. 일일 전체 매수 횟수
      if (limits.dailyTotalMaxCountEnabled && limits.dailyTotalMaxCount !== null) {
        const allBuys = this.db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.accountId, accountId),
              eq(orders.side, 'BUY'),
              gte(orders.placedAt, today),
              inArray(orders.status, ['PENDING', 'PARTIAL', 'FILLED']),
            ),
          )
          .all();
        const current = allBuys.length;
        if (current >= limits.dailyTotalMaxCount) {
          return err({
            kind: 'LIMIT_DAILY_TOTAL_COUNT',
            current,
            max: limits.dailyTotalMaxCount,
          });
        }
      }

      // 3. 일일 전체 매수 금액 합산 (price * qty)
      if (limits.dailyTotalMaxAmountEnabled && limits.dailyTotalMaxAmount !== null) {
        const allBuyOrders = this.db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.accountId, accountId),
              eq(orders.side, 'BUY'),
              gte(orders.placedAt, today),
              inArray(orders.status, ['PENDING', 'PARTIAL', 'FILLED']),
            ),
          )
          .all();
        const currentKrw = allBuyOrders.reduce((acc, o) => acc + o.price * o.qty, 0);
        if (currentKrw + amountKrw > limits.dailyTotalMaxAmount) {
          return err({
            kind: 'LIMIT_DAILY_TOTAL_AMOUNT',
            currentKrw,
            maxKrw: limits.dailyTotalMaxAmount,
          });
        }
      }

      // 4. 계좌 총 오픈 포지션 금액 (OPEN 차수의 amountKrw 합산)
      if (limits.accountTotalMaxAmountEnabled && limits.accountTotalMaxAmount !== null) {
        const openLotsResult = this.db
          .select({ total: sum(lots.amountKrw) })
          .from(lots)
          .where(and(eq(lots.accountId, accountId), eq(lots.status, 'OPEN')))
          .get();
        const currentKrw = Number(openLotsResult?.total ?? 0);
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
