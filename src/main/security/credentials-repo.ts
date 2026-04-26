import type { AppEnv, BrokerId, Credentials } from '@shared/contracts';
import { CredentialsSchema } from '@shared/contracts';
import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { credentials as credentialsTable } from '../db/schema';

/**
 * Electron safeStorage와 동일한 API를 가진 최소 인터페이스.
 * 실제 구현은 `electron.safeStorage`를 주입, 테스트에서는 mock 주입.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type CredentialsRepoError =
  | { kind: 'ENCRYPTION_UNAVAILABLE' }
  | { kind: 'VALIDATION'; msg: string }
  | { kind: 'DECRYPT_FAILED'; cause: unknown }
  | { kind: 'DB_ERROR'; cause: unknown }
  | { kind: 'NOT_FOUND'; msg: string };

/**
 * 자격증명 저장소 — 계좌(account_id) 단위 1행.
 * 저장 시 JSON.stringify → safeStorage.encryptString → SQLite BLOB.
 * 읽기 시 BLOB → decryptString → JSON.parse → Zod 검증.
 *
 * 보안 불변식:
 * - 평문은 함수 외부에 반환되지만 파일/로그/DB 어디에도 평문 저장 금지.
 * - 로그에 남길 때는 반드시 maskSecret 적용 (호출측 책임).
 * - account_id 가 명시적으로 전달되어야 한다 — 다른 계좌 자격증명 잘못 사용 방지.
 *
 * BC 노트: env 단위 lookup 은 `loadCredentialsByEnv(env)` / `clearCredentialsByEnv(env)` 로
 * 명시적으로 분리. 새 코드는 가능한 accountId 기반 API 사용.
 */
export class CredentialsRepo {
  constructor(
    private readonly db: Db,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  /**
   * 계좌별 자격증명 저장.
   * payload.env 와 호출측 의도가 일치해야 함 (env 컬럼은 payload.env 로 채움).
   */
  saveCredentials(accountId: number, value: Credentials): Result<void, CredentialsRepoError> {
    const parsed = CredentialsSchema.safeParse(value);
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', msg: parsed.error.message });
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      return err({ kind: 'ENCRYPTION_UNAVAILABLE' });
    }
    try {
      const payload = this.safeStorage.encryptString(JSON.stringify(parsed.data));
      const now = new Date();
      const existing = this.db
        .select({ accountId: credentialsTable.accountId })
        .from(credentialsTable)
        .where(eq(credentialsTable.accountId, accountId))
        .all();
      if (existing.length > 0) {
        this.db
          .update(credentialsTable)
          .set({
            env: parsed.data.env,
            broker: parsed.data.broker,
            payload,
            updatedAt: now,
          })
          .where(eq(credentialsTable.accountId, accountId))
          .run();
      } else {
        this.db
          .insert(credentialsTable)
          .values({
            accountId,
            env: parsed.data.env,
            broker: parsed.data.broker,
            payload,
            updatedAt: now,
          })
          .run();
      }
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  loadCredentials(accountId: number): Result<Credentials | null, CredentialsRepoError> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return err({ kind: 'ENCRYPTION_UNAVAILABLE' });
    }
    let rows: Array<typeof credentialsTable.$inferSelect>;
    try {
      rows = this.db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.accountId, accountId))
        .all();
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
    const first = rows[0];
    if (!first) return ok(null);
    return this.decodeRow(first);
  }

  clearCredentials(accountId: number): Result<void, CredentialsRepoError> {
    try {
      this.db.delete(credentialsTable).where(eq(credentialsTable.accountId, accountId)).run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * BC 호환: env 로 lookup. (env, broker) UNIQUE 로 같은 env 라도 broker 다르면 별행.
   * broker 미지정 시 'KIS' fallback (기존 호출자가 KIS 만 다뤘으므로 안전).
   *
   * 새 코드는 ActiveAccountRepo 로 accountId 를 먼저 얻고 `loadCredentials(accountId)` 사용.
   */
  loadCredentialsByEnv(
    env: AppEnv,
    broker: BrokerId = 'KIS',
  ): Result<Credentials | null, CredentialsRepoError> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return err({ kind: 'ENCRYPTION_UNAVAILABLE' });
    }
    let rows: Array<typeof credentialsTable.$inferSelect>;
    try {
      rows = this.db
        .select()
        .from(credentialsTable)
        .where(and(eq(credentialsTable.env, env), eq(credentialsTable.broker, broker)))
        .all();
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
    const first = rows[0];
    if (!first) return ok(null);
    return this.decodeRow(first);
  }

  /**
   * BC 호환: env 단위 삭제. broker 미지정 시 'KIS' 만 삭제 (기존 호출자 호환).
   */
  clearCredentialsByEnv(env: AppEnv, broker: BrokerId = 'KIS'): Result<void, CredentialsRepoError> {
    try {
      this.db
        .delete(credentialsTable)
        .where(and(eq(credentialsTable.env, env), eq(credentialsTable.broker, broker)))
        .run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /**
   * env 로 accountId 역추적 — auth-router 의 setEnv 호환용.
   * broker 미지정 시 'KIS' fallback.
   */
  resolveAccountIdByEnv(env: AppEnv, broker: BrokerId = 'KIS'): number | null {
    try {
      const row = this.db
        .select({ accountId: credentialsTable.accountId })
        .from(credentialsTable)
        .where(and(eq(credentialsTable.env, env), eq(credentialsTable.broker, broker)))
        .all()[0];
      return row?.accountId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 저장된 모든 entry — auth.listStored 용 (accountId/env/broker).
   */
  listEntries(): Array<{ accountId: number; env: AppEnv; broker: BrokerId }> {
    try {
      const rows = this.db
        .select({
          accountId: credentialsTable.accountId,
          env: credentialsTable.env,
          broker: credentialsTable.broker,
        })
        .from(credentialsTable)
        .all();
      return rows.map((r) => ({
        accountId: r.accountId,
        env: r.env as AppEnv,
        broker: (r.broker as BrokerId) ?? 'KIS',
      }));
    } catch {
      return [];
    }
  }

  private decodeRow(
    row: typeof credentialsTable.$inferSelect,
  ): Result<Credentials, CredentialsRepoError> {
    let plain: string;
    try {
      plain = this.safeStorage.decryptString(row.payload as Buffer);
    } catch (cause) {
      return err({ kind: 'DECRYPT_FAILED', cause });
    }
    const parsed = CredentialsSchema.safeParse(JSON.parse(plain));
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', msg: parsed.error.message });
    }
    return ok(parsed.data);
  }
}
