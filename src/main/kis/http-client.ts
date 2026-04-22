import type { KisError } from '@shared/contracts';
import Bottleneck from 'bottleneck';
import { err, ok, type Result } from 'neverthrow';
import { type Dispatcher, request as undiciRequest } from 'undici';
import type { EventLogger } from '../logging/event-logger';
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
  /**
   * 요청/응답/에러 감사 로그 sink. dev 디버깅 시 logs 페이지에서
   * `message LIKE 'kis.http.%'` 로 필터해 네트워크 요청을 조회 가능.
   * headers/query/body 는 민감정보 우려로 기록하지 않음 — path + status + durationMs 중심.
   */
  logger?: EventLogger;
  /** 환경 라벨 (MOCK|PROD) — 로그 payload 에 포함. */
  envLabel?: string;
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
    // KIS 서버는 최근 1초 rolling window 기준으로 유량을 계산하는 경향이 있어,
    // 1초 단위 reservoir reset 방식은 초 경계에서 burst를 만들 수 있다.
    // 고정 간격(minTime) + 단일 동시성으로 요청을 직렬화해 burst를 제거한다.
    this.limiter = new Bottleneck({
      minTime: Math.ceil(1000 / rps),
      maxConcurrent: 1,
    });
  }

  async get<T = unknown>(
    path: string,
    params: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<Result<KisHttpResponse<T>, KisError>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.config.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const trId = headers.tr_id ?? headers.TR_ID;
    return this.limiter.schedule(() => this.send<T>(url, path, 'GET', headers, null, trId));
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
    const trId = merged.tr_id ?? merged.TR_ID;
    return this.limiter.schedule(() => this.send<T>(url, path, 'POST', merged, payload, trId));
  }

  private async send<T>(
    url: string,
    path: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body: string | null,
    trId: string | undefined,
  ): Promise<Result<KisHttpResponse<T>, KisError>> {
    const logger = this.config.logger;
    const env = this.config.envLabel;
    const startedAt = Date.now();
    logger?.log({
      level: 'INFO',
      category: 'SYS',
      message: 'kis.http.request',
      payload: { env, method, path, trId },
    });
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
        const durationMs = Date.now() - startedAt;
        if (res.statusCode >= 500) {
          // KIS 는 토큰 만료/인증 실패 등을 500 + body JSON 으로 반환하는 경우가 있음.
          // body 파싱 성공 시 해당 kind 로 분류해 상위 재인증 훅이 발화하게 한다.
          const classified = classifyFromBody(res.statusCode, text);
          const e =
            classified ??
            makeKisError('NETWORK', `HTTP ${res.statusCode}`, {
              cause: { status: res.statusCode, body: text.slice(0, 200) },
            });
          logger?.log({
            level: 'ERROR',
            category: 'SYS',
            message: 'kis.http.error',
            payload: {
              env,
              method,
              path,
              trId,
              status: res.statusCode,
              durationMs,
              kind: e.kind,
              msg: e.msg,
              body: text.slice(0, 200),
            },
          });
          return err(e);
        }
        if (res.statusCode === 429) {
          logger?.log({
            level: 'ERROR',
            category: 'SYS',
            message: 'kis.http.error',
            payload: {
              env,
              method,
              path,
              trId,
              status: 429,
              durationMs,
              kind: 'RATE_LIMITED',
              body: text.slice(0, 200),
            },
          });
          return err(makeKisError('RATE_LIMITED', 'HTTP 429', { cause: text }));
        }
        if (res.statusCode === 401 || res.statusCode === 403) {
          logger?.log({
            level: 'ERROR',
            category: 'SYS',
            message: 'kis.http.error',
            payload: {
              env,
              method,
              path,
              trId,
              status: res.statusCode,
              durationMs,
              kind: 'AUTH_FAILED',
              body: text.slice(0, 200),
            },
          });
          return err(makeKisError('AUTH_FAILED', `HTTP ${res.statusCode}`, { cause: text }));
        }
        let parsed: T;
        try {
          parsed = text ? (JSON.parse(text) as T) : ({} as T);
        } catch (cause) {
          logger?.log({
            level: 'ERROR',
            category: 'SYS',
            message: 'kis.http.error',
            payload: {
              env,
              method,
              path,
              trId,
              status: res.statusCode,
              durationMs,
              kind: 'UNKNOWN',
              msg: 'Invalid JSON response',
            },
          });
          return err(makeKisError('UNKNOWN', 'Invalid JSON response', { cause }));
        }
        // rt_cd 가 0 아닌 경우 business error 로 간주해 WARN 으로 기록.
        const rtCd = (parsed as { rt_cd?: string })?.rt_cd;
        const msgCd = (parsed as { msg_cd?: string })?.msg_cd;
        const isBizError = typeof rtCd === 'string' && rtCd !== '0';
        logger?.log({
          level: isBizError ? 'WARN' : 'INFO',
          category: 'SYS',
          message: 'kis.http.response',
          payload: {
            env,
            method,
            path,
            trId,
            status: res.statusCode,
            durationMs,
            ...(rtCd !== undefined ? { rtCd } : {}),
            ...(msgCd !== undefined ? { msgCd } : {}),
          },
        });
        return ok({
          status: res.statusCode,
          body: parsed,
          headers: res.headers as Record<string, string | string[] | undefined>,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      logger?.log({
        level: 'ERROR',
        category: 'SYS',
        message: 'kis.http.error',
        payload: {
          env,
          method,
          path,
          trId,
          durationMs,
          kind: 'NETWORK',
          msg: cause instanceof Error ? cause.message : String(cause),
        },
      });
      return err(makeKisError('NETWORK', 'fetch failed', { cause }));
    }
  }
}
