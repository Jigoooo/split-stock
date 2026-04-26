import type { AppEnv } from '@shared/contracts';
import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../../db/client';
import { accessTokens } from '../../db/schema';

export interface KiwoomStoredToken {
  token: string;
  tokenType: string;
  /** epoch ms. */
  expiresAt: number;
  /** epoch ms. */
  issuedAt: number;
}

export type KiwoomTokenStoreError = { kind: 'DB_ERROR'; cause: unknown };

const BROKER = 'KIWOOM' as const;

/**
 * Kiwoom 액세스 토큰 캐시 — env 별 1행. KIS 와 동일 PK `(broker, env)`,
 * 같은 access_tokens 테이블 공유. 6h 재사용 정책 동일.
 */
export class KiwoomTokenStore {
  constructor(private readonly db: Db) {}

  save(env: AppEnv, value: KiwoomStoredToken): Result<void, KiwoomTokenStoreError> {
    const where = and(eq(accessTokens.broker, BROKER), eq(accessTokens.env, env));
    try {
      const existing = this.db.select().from(accessTokens).where(where).all();
      if (existing.length > 0) {
        this.db
          .update(accessTokens)
          .set({
            token: value.token,
            tokenType: value.tokenType,
            expiresAt: new Date(value.expiresAt),
            issuedAt: new Date(value.issuedAt),
          })
          .where(where)
          .run();
      } else {
        this.db
          .insert(accessTokens)
          .values({
            broker: BROKER,
            env,
            token: value.token,
            tokenType: value.tokenType,
            expiresAt: new Date(value.expiresAt),
            issuedAt: new Date(value.issuedAt),
          })
          .run();
      }
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  load(env: AppEnv): Result<KiwoomStoredToken | null, KiwoomTokenStoreError> {
    const where = and(eq(accessTokens.broker, BROKER), eq(accessTokens.env, env));
    try {
      const rows = this.db.select().from(accessTokens).where(where).all();
      const row = rows[0];
      if (!row) return ok(null);
      return ok({
        token: row.token,
        tokenType: row.tokenType,
        expiresAt: row.expiresAt.getTime(),
        issuedAt: row.issuedAt.getTime(),
      });
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  clear(env: AppEnv): Result<void, KiwoomTokenStoreError> {
    const where = and(eq(accessTokens.broker, BROKER), eq(accessTokens.env, env));
    try {
      this.db.delete(accessTokens).where(where).run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /** 남은 유효시간이 safetyMs 초과면 true (KIS 와 동일 6h 정책). */
  static isReusable(
    token: KiwoomStoredToken,
    nowMs: number,
    safetyMs = 6 * 60 * 60 * 1000,
  ): boolean {
    return token.expiresAt - nowMs > safetyMs;
  }
}
