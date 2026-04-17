import type { KisError } from '@shared/contracts';
import Bottleneck from 'bottleneck';
import { err, ok, type Result } from 'neverthrow';
import { type Dispatcher, request as undiciRequest } from 'undici';
import { makeKisError } from './errors';

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
