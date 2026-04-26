import type { AppEnv, BrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import { type Dispatcher, request as undiciRequest } from 'undici';
import { classifyKiwoomBody, classifyKiwoomTransport } from './errors';
import { KIWOOM_BASE_URL, KIWOOM_PATH } from './metadata/endpoints';

export interface KiwoomTokenResponse {
  /** Bearer 토큰 본문. */
  token: string;
  /** 'bearer' (Kiwoom 응답에 항상 lowercase). */
  tokenType: string;
  /** 'YYYYMMDDHHMMSS' 형식 (KST). adapter 가 epoch ms 로 변환. */
  expiresDt: string;
}

export interface KiwoomAuthOptions {
  env: AppEnv;
  appKey: string;
  secretKey: string;
  dispatcher?: Dispatcher;
}

/**
 * Kiwoom OAuth — `POST /oauth2/token` (KIS 와 달리 `secretkey` 키 이름이 소문자).
 *
 * 응답: `{ token, token_type:'bearer', expires_dt:'YYYYMMDDHHMMSS', return_code:0 }`.
 * 토큰 24h 유효이지만 만료 6h 이내면 재발급 (broker-agnostic policy).
 */
export class KiwoomAuth {
  constructor(private readonly options: KiwoomAuthOptions) {}

  /** 토큰 발급. 실패 시 BrokerError 반환. */
  async generateToken(): Promise<Result<KiwoomTokenResponse, BrokerError>> {
    const url = `${KIWOOM_BASE_URL[this.options.env]}${KIWOOM_PATH.TOKEN}`;
    try {
      const resp = await undiciRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: this.options.appKey,
          secretkey: this.options.secretKey,
        }),
        ...(this.options.dispatcher !== undefined && { dispatcher: this.options.dispatcher }),
      });
      const text = await resp.body.text();
      let parsed: {
        token?: string;
        token_type?: string;
        expires_dt?: string;
        return_code?: number;
        return_msg?: string;
      } | null = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        return err(classifyKiwoomTransport(new Error('Kiwoom auth response not JSON')));
      }

      if (
        resp.statusCode >= 400 ||
        (parsed?.return_code !== undefined && parsed.return_code !== 0)
      ) {
        const bizErr = classifyKiwoomBody(resp.statusCode, parsed);
        if (bizErr) return err(bizErr);
        return err(classifyKiwoomTransport(new Error(`Kiwoom auth HTTP ${resp.statusCode}`)));
      }

      if (!parsed?.token || !parsed?.expires_dt) {
        return err(classifyKiwoomTransport(new Error('Kiwoom auth response missing fields')));
      }
      return ok({
        token: parsed.token,
        tokenType: parsed.token_type ?? 'bearer',
        expiresDt: parsed.expires_dt,
      });
    } catch (cause) {
      return err(classifyKiwoomTransport(cause));
    }
  }

  /** 토큰 폐기 (선택 — 보안 종료 시). */
  async revokeToken(token: string): Promise<Result<void, BrokerError>> {
    const url = `${KIWOOM_BASE_URL[this.options.env]}${KIWOOM_PATH.TOKEN_REVOKE}`;
    try {
      const resp = await undiciRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          appkey: this.options.appKey,
          secretkey: this.options.secretKey,
          token,
        }),
        ...(this.options.dispatcher !== undefined && { dispatcher: this.options.dispatcher }),
      });
      if (resp.statusCode >= 400) {
        return err(classifyKiwoomTransport(new Error(`Kiwoom revoke HTTP ${resp.statusCode}`)));
      }
      return ok(undefined);
    } catch (cause) {
      return err(classifyKiwoomTransport(cause));
    }
  }
}

/** Kiwoom expires_dt 'YYYYMMDDHHMMSS' (KST) → epoch ms. */
export function parseKiwoomExpiry(expiresDt: string): number {
  if (expiresDt.length !== 14) return Date.now() + 23 * 60 * 60 * 1000;
  const y = Number(expiresDt.slice(0, 4));
  const m = Number(expiresDt.slice(4, 6));
  const d = Number(expiresDt.slice(6, 8));
  const hh = Number(expiresDt.slice(8, 10));
  const mm = Number(expiresDt.slice(10, 12));
  const ss = Number(expiresDt.slice(12, 14));
  // KST = UTC+9
  return Date.UTC(y, m - 1, d, hh - 9, mm, ss);
}
