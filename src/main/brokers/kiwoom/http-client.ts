import type { BrokerError } from '@shared/contracts';
import Bottleneck from 'bottleneck';
import { err, ok, type Result } from 'neverthrow';
import { type Dispatcher, request as undiciRequest } from 'undici';
import { classifyKiwoomBody, classifyKiwoomTransport } from './errors';

export interface KiwoomHttpConfig {
  baseUrl: string;
  dispatcher?: Dispatcher;
  /** 초당 요청 상한 (Kiwoom 공식 미공개 — 보수적 8/s). */
  rateLimitRps?: number;
  timeoutMs?: number;
}

export interface KiwoomHttpResponse<T> {
  status: number;
  body: T;
  /** Kiwoom 페이지네이션 응답 헤더 — 다음 요청에 그대로 전달. */
  contYn: string | undefined;
  nextKey: string | undefined;
}

export interface KiwoomPostOptions {
  apiId: string;
  /** 페이지네이션 입력 — 첫 호출 'N' / 후속 'Y'. */
  contYn?: string;
  nextKey?: string;
}

/**
 * Kiwoom REST HTTP client — undici + Bottleneck 레이트리밋.
 *
 * 모든 Kiwoom 도메인 endpoint 는 POST + JSON body. 헤더:
 *  - authorization: Bearer <token>
 *  - content-type: application/json;charset=UTF-8
 *  - api-id: <kt|ka prefix>
 *  - cont-yn / next-key (페이지네이션)
 *
 * Stage 6a 시점에는 본 client 가 호출되지 않는다 — Stage 6b 부터 KiwoomAdapter
 * 가 본 client 를 사용한다.
 */
export class KiwoomHttpClient {
  private readonly limiter: Bottleneck;

  constructor(private readonly config: KiwoomHttpConfig) {
    const rps = config.rateLimitRps ?? 8;
    this.limiter = new Bottleneck({
      minTime: Math.ceil(1000 / rps),
      maxConcurrent: 1,
    });
  }

  /** Kiwoom 인증/도메인 endpoint 공용 POST. */
  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    token: string,
    options: KiwoomPostOptions,
  ): Promise<Result<KiwoomHttpResponse<T>, BrokerError>> {
    return this.limiter.schedule(async () => {
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json;charset=UTF-8',
          'api-id': options.apiId,
          'cont-yn': options.contYn ?? 'N',
          'next-key': options.nextKey ?? '',
        };
        const url = `${this.config.baseUrl}${path}`;
        const resp = await undiciRequest(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          ...(this.config.dispatcher !== undefined && { dispatcher: this.config.dispatcher }),
          ...(this.config.timeoutMs !== undefined && {
            bodyTimeout: this.config.timeoutMs,
            headersTimeout: this.config.timeoutMs,
          }),
        });
        const text = await resp.body.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          // body 가 JSON 이 아닌 경우 — 비즈니스 에러로 분류
        }
        const contYnHeader = resp.headers['cont-yn'];
        const nextKeyHeader = resp.headers['next-key'];
        const contYn = Array.isArray(contYnHeader) ? contYnHeader[0] : contYnHeader;
        const nextKey = Array.isArray(nextKeyHeader) ? nextKeyHeader[0] : nextKeyHeader;

        if (resp.statusCode >= 400) {
          const bizErr = classifyKiwoomBody(
            resp.statusCode,
            (parsed as { return_code?: number | string; return_msg?: string } | null) ?? null,
          );
          if (bizErr) return err(bizErr);
          return err(classifyKiwoomTransport(new Error(`HTTP ${resp.statusCode}`)));
        }

        const bodyJson = (parsed ?? {}) as { return_code?: number; return_msg?: string };
        if (bodyJson.return_code !== undefined && bodyJson.return_code !== 0) {
          const bizErr = classifyKiwoomBody(resp.statusCode, bodyJson);
          if (bizErr) return err(bizErr);
        }

        return ok({
          status: resp.statusCode,
          body: parsed as T,
          contYn,
          nextKey,
        });
      } catch (cause) {
        return err(classifyKiwoomTransport(cause));
      }
    });
  }
}
