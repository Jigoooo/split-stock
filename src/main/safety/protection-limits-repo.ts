import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { protectionLimits } from '../db/schema';

export interface ProtectionLimitsRow {
  accountId: number;
  perSymbolDailyMaxBuys: number | null;
  dailyTotalMaxAmount: number | null;
  dailyTotalMaxCount: number | null;
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
    perSymbolDailyMaxBuys: row.perSymbolDailyMaxBuys ?? null,
    dailyTotalMaxAmount: row.dailyTotalMaxAmount ?? null,
    dailyTotalMaxCount: row.dailyTotalMaxCount ?? null,
    accountTotalMaxAmount: row.accountTotalMaxAmount ?? null,
    rateGuardEnabled: row.rateGuardEnabled === 1,
    rateGuardWindowSeconds: row.rateGuardWindowSeconds ?? null,
    rateGuardMaxCount: row.rateGuardMaxCount ?? null,
    updatedAt: row.updatedAt,
  };
}

export interface SetProtectionLimitsInput {
  perSymbolDailyMaxBuys?: number | null;
  dailyTotalMaxAmount?: number | null;
  dailyTotalMaxCount?: number | null;
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
      this.db
        .insert(protectionLimits)
        .values({
          accountId,
          perSymbolDailyMaxBuys: input.perSymbolDailyMaxBuys ?? null,
          dailyTotalMaxAmount: input.dailyTotalMaxAmount ?? null,
          dailyTotalMaxCount: input.dailyTotalMaxCount ?? null,
          accountTotalMaxAmount: input.accountTotalMaxAmount ?? null,
          rateGuardEnabled: input.rateGuardEnabled ? 1 : 0,
          rateGuardWindowSeconds: input.rateGuardWindowSeconds ?? null,
          rateGuardMaxCount: input.rateGuardMaxCount ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: protectionLimits.accountId,
          set: {
            perSymbolDailyMaxBuys: input.perSymbolDailyMaxBuys ?? null,
            dailyTotalMaxAmount: input.dailyTotalMaxAmount ?? null,
            dailyTotalMaxCount: input.dailyTotalMaxCount ?? null,
            accountTotalMaxAmount: input.accountTotalMaxAmount ?? null,
            rateGuardEnabled: input.rateGuardEnabled ? 1 : 0,
            rateGuardWindowSeconds: input.rateGuardWindowSeconds ?? null,
            rateGuardMaxCount: input.rateGuardMaxCount ?? null,
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
