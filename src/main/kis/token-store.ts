import type { AppEnv } from '@shared/contracts';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import type { Db } from '../db/client';
import { accessTokens } from '../db/schema';

export interface StoredToken {
  token: string;
  tokenType: string;
  expiresAt: number; // epoch ms
  issuedAt: number; // epoch ms
}

export type TokenStoreError = { kind: 'DB_ERROR'; cause: unknown };

/**
 * 액세스 토큰 캐시 — env별 1행.
 * KIS 정책: 발급 후 24h 유효, 만료 6h 이내면 재발급 시 기존 토큰 유지.
 * 따라서 로컬에선 (expiresAt - now) > 6h인 토큰만 재사용.
 */
export class TokenStore {
  constructor(private readonly db: Db) {}

  save(env: AppEnv, value: StoredToken): Result<void, TokenStoreError> {
    try {
      const existing = this.db.select().from(accessTokens).where(eq(accessTokens.env, env)).all();
      if (existing.length > 0) {
        this.db
          .update(accessTokens)
          .set({
            token: value.token,
            tokenType: value.tokenType,
            expiresAt: new Date(value.expiresAt),
            issuedAt: new Date(value.issuedAt),
          })
          .where(eq(accessTokens.env, env))
          .run();
      } else {
        this.db
          .insert(accessTokens)
          .values({
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

  load(env: AppEnv): Result<StoredToken | null, TokenStoreError> {
    try {
      const rows = this.db.select().from(accessTokens).where(eq(accessTokens.env, env)).all();
      if (rows.length === 0) return ok(null);
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

  clear(env: AppEnv): Result<void, TokenStoreError> {
    try {
      this.db.delete(accessTokens).where(eq(accessTokens.env, env)).run();
      return ok(undefined);
    } catch (cause) {
      return err({ kind: 'DB_ERROR', cause });
    }
  }

  /** 남은 유효시간이 safetyMs 초과면 true. */
  static isReusable(token: StoredToken, nowMs: number, safetyMs = 6 * 60 * 60 * 1000): boolean {
    return token.expiresAt - nowMs > safetyMs;
  }
}
