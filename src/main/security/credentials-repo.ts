import type { AppEnv, Credentials } from '@shared/contracts';
import { CredentialsSchema } from '@shared/contracts';
import { eq } from 'drizzle-orm';
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
  | { kind: 'DB_ERROR'; cause: unknown };

/**
 * 자격증명 저장소 (env별 1행).
 * 저장 시 JSON.stringify → safeStorage.encryptString → SQLite BLOB.
 * 읽기 시 BLOB → decryptString → JSON.parse → Zod 검증.
 *
 * 보안 불변식:
 * - 평문은 함수 외부에 반환되지만 파일/로그/DB 어디에도 평문 저장 금지.
 * - 로그에 남길 때는 반드시 maskSecret 적용 (호출측 책임).
 */
export class CredentialsRepo {
  constructor(
    private readonly db: Db,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  saveCredentials(value: Credentials): Result<void, CredentialsRepoError> {
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
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.env, parsed.data.env))
        .all();
      if (existing.length > 0) {
        this.db
          .update(credentialsTable)
          .set({ payload, updatedAt: now })
          .where(eq(credentialsTable.env, parsed.data.env))
          .run();
      } else {
        this.db
          .insert(credentialsTable)
          .values({ env: parsed.data.env, payload, updatedAt: now })
          .run();
      }
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  loadCredentials(env: AppEnv): Result<Credentials | null, CredentialsRepoError> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return err({ kind: 'ENCRYPTION_UNAVAILABLE' });
    }
    let rows: Array<typeof credentialsTable.$inferSelect>;
    try {
      rows = this.db.select().from(credentialsTable).where(eq(credentialsTable.env, env)).all();
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
    if (rows.length === 0) return ok(null);
    const row = rows[0];
    if (!row) return ok(null);
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

  clearCredentials(env: AppEnv): Result<void, CredentialsRepoError> {
    try {
      this.db.delete(credentialsTable).where(eq(credentialsTable.env, env)).run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }
}
