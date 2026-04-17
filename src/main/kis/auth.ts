import type { AppEnv, KisError } from '@shared/contracts';
import { KisTokenResponseSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { KIS_PATH } from './endpoints';
import { makeKisError } from './errors';
import type { KisHttpClient } from './http-client';
import { type StoredToken, TokenStore } from './token-store';

export interface AuthServiceOptions {
  /** 재시도 최대 횟수 (기본 3). 지수백오프 base 500ms. */
  maxRetries?: number;
  /** Date.now 주입 — 테스트용. */
  now?: () => number;
}

/**
 * KIS OAuth 토큰 발급/갱신 서비스.
 * - 저장된 토큰이 재사용 가능(만료까지 >6h)하면 DB 것 반환
 * - 아니면 /oauth2/tokenP 호출 → 저장 → 반환
 * - 네트워크 실패는 지수백오프로 재시도, 그 외 에러는 즉시 반환
 */
export class AuthService {
  private readonly maxRetries: number;
  private readonly now: () => number;

  constructor(
    private readonly http: KisHttpClient,
    private readonly store: TokenStore,
    options: AuthServiceOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.now = options.now ?? (() => Date.now());
  }

  async getValidToken(
    env: AppEnv,
    appKey: string,
    appSecret: string,
  ): Promise<Result<StoredToken, KisError>> {
    const cached = this.store.load(env);
    if (cached.isOk() && cached.value && TokenStore.isReusable(cached.value, this.now())) {
      return ok(cached.value);
    }
    return this.issueAndStore(env, appKey, appSecret);
  }

  async issueAndStore(
    env: AppEnv,
    appKey: string,
    appSecret: string,
  ): Promise<Result<StoredToken, KisError>> {
    const result = await this.issueWithRetry(appKey, appSecret);
    if (result.isErr()) return err(result.error);
    const saveResult = this.store.save(env, result.value);
    if (saveResult.isErr()) {
      return err(makeKisError('UNKNOWN', 'token save failed', { cause: saveResult.error }));
    }
    return ok(result.value);
  }

  private async issueWithRetry(
    appKey: string,
    appSecret: string,
  ): Promise<Result<StoredToken, KisError>> {
    let lastErr: KisError | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const r = await this.issueOnce(appKey, appSecret);
      if (r.isOk()) return ok(r.value);
      lastErr = r.error;
      if (r.error.kind !== 'NETWORK' && r.error.kind !== 'RATE_LIMITED') {
        return err(r.error);
      }
      const backoff = 500 * 2 ** attempt;
      await delay(backoff);
    }
    return err(lastErr ?? makeKisError('UNKNOWN', 'issue failed'));
  }

  private async issueOnce(
    appKey: string,
    appSecret: string,
  ): Promise<Result<StoredToken, KisError>> {
    const r = await this.http.post<unknown>(KIS_PATH.TOKEN_ISSUE, {
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    });
    if (r.isErr()) return err(r.error);
    const parsed = KisTokenResponseSchema.safeParse(r.value.body);
    if (!parsed.success) {
      return err(
        makeKisError('VALIDATION', 'token response malformed', {
          cause: parsed.error.message,
        }),
      );
    }
    const issuedAt = this.now();
    const expiresAt = issuedAt + parsed.data.expires_in * 1000;
    return ok({
      token: parsed.data.access_token,
      tokenType: parsed.data.token_type,
      issuedAt,
      expiresAt,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
