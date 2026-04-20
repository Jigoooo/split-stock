import type { KisError } from '@shared/contracts';
import Bottleneck from 'bottleneck';
import { err, ok, type Result } from 'neverthrow';
import { type Dispatcher, request as undiciRequest } from 'undici';
import { interpretRtCd, makeKisError } from './errors';

/**
 * KIS는 토큰 만료 같은 인증 실패를 HTTP 401 대신 **HTTP 500 + body 에
 * {"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token 입니다."} JSON**
 * 을 실어 반환하는 경우가 자주 있음. 이를 NETWORK 로 분류하면 자동 재인증 훅이
 * 발화하지 않아 사용자가 계속 500 을 봄. body 를 파싱해 rt_cd/msg_cd 기반으로
 * 정확한 kind (AUTH_FAILED / RATE_LIMITED / API_BUSINESS 등)로 변환.
 */
function classifyFromBody(status: number, text: string): KisError | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { rt_cd?: string; msg_cd?: string; msg1?: string };
    if (typeof parsed.rt_cd === 'string' && parsed.rt_cd !== '0') {
      const biz = interpretRtCd(parsed.rt_cd, parsed.msg_cd ?? '', parsed.msg1 ?? '');
      if (biz) {
        return {
          ...biz,
          cause: { status, body: text.slice(0, 200) },
        };
      }
    }
  } catch {
    // JSON 아님 — caller 가 HTTP 상태 기반 기본 분류 수행
  }
  return null;
}

export interface KisHttpConfig {
  baseUrl: string;
  /** 테스트 주입용 MockAgent 지원. 미지정 시 글로벌 dispatcher 사용. */
  dispatcher?: Dispatcher;
  /** 초당 요청 상한 (기본 15건 — KIS 보수적). */
  rateLimitRps?: number;
  /** 전체 요청 타임아웃 ms. */
  timeoutMs?: number;
}

export interface KisHttpResponse<T> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * KIS REST 전용 HTTP 클라이언트 — undici + Bottleneck 레이트리밋.
 * 응답 파싱은 호출측에서 Zod로 검증해야 함 (2026-02 공지 대응).
 */
export class KisHttpClient {
  private readonly limiter: Bottleneck;

  constructor(private readonly config: KisHttpConfig) {
    const rps = config.rateLimitRps ?? 15;
    this.limiter = new Bottleneck({
      reservoir: rps,
      reservoirRefreshAmount: rps,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 10,
    });
  }

  async get<T = unknown>(
    path: string,
    params: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Result<KisHttpResponse<T>, KisError>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.config.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    return this.limiter.schedule(() => this.send<T>(url, 'GET', headers, null));
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Result<KisHttpResponse<T>, KisError>> {
    const url = `${this.config.baseUrl}${path}`;
    const payload = JSON.stringify(body);
    const merged: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    };
    return this.limiter.schedule(() => this.send<T>(url, 'POST', merged, payload));
  }

  private async send<T>(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body: string | null,
  ): Promise<Result<KisHttpResponse<T>, KisError>> {
    try {
      const timeoutMs = this.config.timeoutMs ?? 10_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const options: Parameters<typeof undiciRequest>[1] = {
          method,
          headers,
          signal: controller.signal,
        };
        if (body !== null) options.body = body;
        if (this.config.dispatcher) options.dispatcher = this.config.dispatcher;
        const res = await undiciRequest(url, options);
        const text = await res.body.text();
        if (res.statusCode >= 500) {
          // KIS 는 토큰 만료/인증 실패 등을 500 + body JSON 으로 반환하는 경우가 있음.
          // body 파싱 성공 시 해당 kind 로 분류해 상위 재인증 훅이 발화하게 한다.
          const classified = classifyFromBody(res.statusCode, text);
          if (classified) return err(classified);
          return err(
            makeKisError('NETWORK', `HTTP ${res.statusCode}`, {
              cause: { status: res.statusCode, body: text.slice(0, 200) },
            }),
          );
        }
        if (res.statusCode === 429) {
          return err(makeKisError('RATE_LIMITED', 'HTTP 429', { cause: text }));
        }
        if (res.statusCode === 401 || res.statusCode === 403) {
          return err(makeKisError('AUTH_FAILED', `HTTP ${res.statusCode}`, { cause: text }));
        }
        let parsed: T;
        try {
          parsed = text ? (JSON.parse(text) as T) : ({} as T);
        } catch (cause) {
          return err(makeKisError('UNKNOWN', 'Invalid JSON response', { cause }));
        }
        return ok({
          status: res.statusCode,
          body: parsed,
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (cause) {
      return err(makeKisError('NETWORK', 'fetch failed', { cause }));
    }
  }
}
