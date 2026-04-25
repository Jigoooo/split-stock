import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { protectionLimits } from '../db/schema';

export interface ProtectionLimitsRow {
  accountId: number;
  perSymbolDailyMaxBuysEnabled: boolean;
  perSymbolDailyMaxBuys: number | null;
  dailyTotalMaxAmountEnabled: boolean;
  dailyTotalMaxAmount: number | null;
  dailyTotalMaxCountEnabled: boolean;
  dailyTotalMaxCount: number | null;
  accountTotalMaxAmountEnabled: boolean;
  accountTotalMaxAmount: number | null;
  rateGuardEnabled: boolean;
  rateGuardWindowSeconds: number | null;
  rateGuardMaxCount: number | null;
  updatedAt: Date;
}

export type ProtectionLimitsRepoError = { kind: 'DB_ERROR'; cause: unknown };

function rowToLimits(row: typeof protectionLimits.$inferSelect): ProtectionLimitsRow {
  return {
    accountId: row.accountId,
    perSymbolDailyMaxBuysEnabled: row.perSymbolDailyMaxBuysEnabled === 1,
    perSymbolDailyMaxBuys: row.perSymbolDailyMaxBuys ?? null,
    dailyTotalMaxAmountEnabled: row.dailyTotalMaxAmountEnabled === 1,
    dailyTotalMaxAmount: row.dailyTotalMaxAmount ?? null,
    dailyTotalMaxCountEnabled: row.dailyTotalMaxCountEnabled === 1,
    dailyTotalMaxCount: row.dailyTotalMaxCount ?? null,
    accountTotalMaxAmountEnabled: row.accountTotalMaxAmountEnabled === 1,
    accountTotalMaxAmount: row.accountTotalMaxAmount ?? null,
    rateGuardEnabled: row.rateGuardEnabled === 1,
    rateGuardWindowSeconds: row.rateGuardWindowSeconds ?? null,
    rateGuardMaxCount: row.rateGuardMaxCount ?? null,
    updatedAt: row.updatedAt,
  };
}

export interface SetProtectionLimitsInput {
  perSymbolDailyMaxBuysEnabled?: boolean;
  perSymbolDailyMaxBuys?: number | null;
  dailyTotalMaxAmountEnabled?: boolean;
  dailyTotalMaxAmount?: number | null;
  dailyTotalMaxCountEnabled?: boolean;
  dailyTotalMaxCount?: number | null;
  accountTotalMaxAmountEnabled?: boolean;
  accountTotalMaxAmount?: number | null;
  rateGuardEnabled?: boolean;
  rateGuardWindowSeconds?: number | null;
  rateGuardMaxCount?: number | null;
}

/**
 * 자동매매 보호 한도 저장소 — 계좌 단위 1행 upsert.
 * NULL = 미설정(제한 없음).
 */
export class ProtectionLimitsRepo {
  constructor(private readonly db: Db) {}

  get(accountId: number): Result<ProtectionLimitsRow | null, ProtectionLimitsRepoError> {
    try {
      const row = this.db
        .select()
        .from(protectionLimits)
        .where(eq(protectionLimits.accountId, accountId))
        .get();
      return ok(row ? rowToLimits(row) : null);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  upsert(
    accountId: number,
    input: SetProtectionLimitsInput,
  ): Result<ProtectionLimitsRow, ProtectionLimitsRepoError> {
    try {
      const now = new Date();
      const existingResult = this.get(accountId);
      if (existingResult.isErr()) return err(existingResult.error);
      const existing = existingResult.value;
      const perSymbolDailyMaxBuys =
        input.perSymbolDailyMaxBuys !== undefined
          ? input.perSymbolDailyMaxBuys
          : (existing?.perSymbolDailyMaxBuys ?? null);
      const dailyTotalMaxAmount =
        input.dailyTotalMaxAmount !== undefined
          ? input.dailyTotalMaxAmount
          : (existing?.dailyTotalMaxAmount ?? null);
      const dailyTotalMaxCount =
        input.dailyTotalMaxCount !== undefined
          ? input.dailyTotalMaxCount
          : (existing?.dailyTotalMaxCount ?? null);
      const accountTotalMaxAmount =
        input.accountTotalMaxAmount !== undefined
          ? input.accountTotalMaxAmount
          : (existing?.accountTotalMaxAmount ?? null);
      const perSymbolDailyMaxBuysEnabled =
        input.perSymbolDailyMaxBuysEnabled ??
        existing?.perSymbolDailyMaxBuysEnabled ??
        perSymbolDailyMaxBuys !== null;
      const dailyTotalMaxAmountEnabled =
        input.dailyTotalMaxAmountEnabled ??
        existing?.dailyTotalMaxAmountEnabled ??
        dailyTotalMaxAmount !== null;
      const dailyTotalMaxCountEnabled =
        input.dailyTotalMaxCountEnabled ??
        existing?.dailyTotalMaxCountEnabled ??
        dailyTotalMaxCount !== null;
      const accountTotalMaxAmountEnabled =
        input.accountTotalMaxAmountEnabled ??
        existing?.accountTotalMaxAmountEnabled ??
        accountTotalMaxAmount !== null;
      const rateGuardEnabled = input.rateGuardEnabled ?? existing?.rateGuardEnabled ?? false;
      const rateGuardWindowSeconds =
        input.rateGuardWindowSeconds !== undefined
          ? input.rateGuardWindowSeconds
          : (existing?.rateGuardWindowSeconds ?? null);
      const rateGuardMaxCount =
        input.rateGuardMaxCount !== undefined
          ? input.rateGuardMaxCount
          : (existing?.rateGuardMaxCount ?? null);
      this.db
        .insert(protectionLimits)
        .values({
          accountId,
          perSymbolDailyMaxBuysEnabled: perSymbolDailyMaxBuysEnabled ? 1 : 0,
          perSymbolDailyMaxBuys,
          dailyTotalMaxAmountEnabled: dailyTotalMaxAmountEnabled ? 1 : 0,
          dailyTotalMaxAmount,
          dailyTotalMaxCountEnabled: dailyTotalMaxCountEnabled ? 1 : 0,
          dailyTotalMaxCount,
          accountTotalMaxAmountEnabled: accountTotalMaxAmountEnabled ? 1 : 0,
          accountTotalMaxAmount,
          rateGuardEnabled: rateGuardEnabled ? 1 : 0,
          rateGuardWindowSeconds,
          rateGuardMaxCount,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: protectionLimits.accountId,
          set: {
            perSymbolDailyMaxBuysEnabled: perSymbolDailyMaxBuysEnabled ? 1 : 0,
            perSymbolDailyMaxBuys,
            dailyTotalMaxAmountEnabled: dailyTotalMaxAmountEnabled ? 1 : 0,
            dailyTotalMaxAmount,
            dailyTotalMaxCountEnabled: dailyTotalMaxCountEnabled ? 1 : 0,
            dailyTotalMaxCount,
            accountTotalMaxAmountEnabled: accountTotalMaxAmountEnabled ? 1 : 0,
            accountTotalMaxAmount,
            rateGuardEnabled: rateGuardEnabled ? 1 : 0,
            rateGuardWindowSeconds,
            rateGuardMaxCount,
            updatedAt: now,
          },
        })
        .run();

      const saved = this.get(accountId);
      if (saved.isErr()) return err(saved.error);
      // upsert 직후이므로 반드시 존재 — null 이면 DB 일관성 위반(예: 다른 트랜잭션이 즉시 삭제).
      if (saved.value === null) {
        return err({
          kind: 'DB_ERROR',
          cause: new Error(
            `protection_limits row missing right after upsert (accountId=${accountId})`,
          ),
        });
      }
      return ok(saved.value);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }
}
