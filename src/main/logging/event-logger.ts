import { createHash } from 'node:crypto';
import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { eventLogs } from '../db/schema';
import { maskSecret } from '../security/mask-secret';

export type EventLevel = 'INFO' | 'WARN' | 'ERROR';
export type EventCategory = 'AUTH' | 'ORDER' | 'FSM' | 'WS' | 'SYS' | 'BALANCE' | 'WATCH';

export interface EventLogEntry {
  level: EventLevel;
  category: EventCategory;
  message: string;
  payload?: Record<string, unknown>;
  /**
   * 차수 수동편집 등 before/after 스냅샷 기록용 별도 필드.
   * payload 와 동일하게 maskPayload 로 정화 후 audit_payload 컬럼에 JSON 직렬화.
   */
  audit?: Record<string, unknown>;
  /** 부가 민감 필드 키 (자동 마스킹 대상). */
  secretKeys?: readonly string[];
}

export interface EventLogger {
  log(entry: EventLogEntry): void;
}

const DEFAULT_SECRET_KEYS = [
  'appKey',
  'appSecret',
  'apiKey',
  'serviceKey',
  'clientSecret',
  'client_secret',
  'x-naver-client-secret',
  'token',
  'access_token',
  'password',
  'authorization',
] as const;

export const API_EXTERNAL_FAILED_MESSAGE = 'api.external.failed';

export type ExternalApiLogSource =
  | 'naver-news'
  | 'naver-datalab'
  | 'dart'
  | 'krx'
  | 'ecos'
  | 'ksd'
  | 'fsc-stock-lending'
  | 'eia'
  | 'kosis';

export interface ExternalApiFailureLogInput {
  source: ExternalApiLogSource;
  endpoint: string;
  status?: string | number | null | undefined;
  reason: string;
  usedCache?: boolean | undefined;
  stale?: boolean | undefined;
  durationMs?: number | undefined;
  responseBody?: string | null | undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function maskPayload(
  value: unknown,
  secretKeys: readonly string[] = DEFAULT_SECRET_KEYS,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => maskPayload(v, secretKeys));
  }
  if (!isPlainObject(value)) return value;
  const secretKeySet = new Set(secretKeys.map((k) => k.toLowerCase()));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (secretKeySet.has(k.toLowerCase()) && typeof v === 'string') {
      out[k] = maskSecret(v);
    } else if (isPlainObject(v) || Array.isArray(v)) {
      out[k] = maskPayload(v, secretKeys);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 원주문 식별자를 로그에 그대로 노출하지 않기 위한 해시.
 * - 단방향 sha256 앞 12자리 — 감사 시 원값과 비교는 해시 재계산으로 대체.
 */
export function hashIdentifier(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/**
 * event_logs 테이블 기반 이벤트 로거.
 * - payload는 항상 maskPayload로 정화 후 JSON 직렬화.
 * - DB 쓰기 실패 시 콘솔에 fallback 기록 (logger 자신은 예외를 던지지 않음).
 */
/**
 * 여러 EventLogger를 병합 — 동일 entry를 모든 sink에 순차 전달.
 * 개별 sink의 실패는 서로에게 영향을 주지 않음(각자 내부에서 swallow 전제).
 */
export function teeLoggers(...loggers: EventLogger[]): EventLogger {
  return {
    log(entry: EventLogEntry): void {
      for (const l of loggers) l.log(entry);
    },
  };
}

/**
 * API 실패 이벤트만 dedicated sink 에도 복제한다.
 *
 * primaryLogger 는 기존 DB/일반 파일 로그를 그대로 담당하고, apiFailureLogger 는
 * `api.external.failed` 이벤트만 받는다. API 정상/일반 경고가 api-errors 파일에 섞이지 않게
 * 하기 위한 얇은 라우팅 계층.
 */
export function createApiFailureLogger(
  primaryLogger: EventLogger,
  apiFailureLogger: EventLogger,
): EventLogger {
  return {
    log(entry: EventLogEntry): void {
      try {
        primaryLogger.log(entry);
      } catch {
        // logger 실패는 업무 흐름에 영향을 주면 안 된다.
      }
      if (entry.message !== API_EXTERNAL_FAILED_MESSAGE) return;
      try {
        apiFailureLogger.log(entry);
      } catch {
        // dedicated API 파일 로그 실패도 삼킨다.
      }
    },
  };
}

export function logExternalApiFailure(
  logger: EventLogger,
  input: ExternalApiFailureLogInput,
): void {
  logger.log({
    level: 'WARN',
    category: 'SYS',
    message: API_EXTERNAL_FAILED_MESSAGE,
    payload: {
      source: input.source,
      endpoint: truncate(input.endpoint, 300),
      status: input.status ?? null,
      reason: truncate(input.reason, 500),
      usedCache: input.usedCache ?? false,
      stale: input.stale ?? false,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.responseBody ? { responseBody: truncate(input.responseBody, 1000) } : {}),
    },
  });
}

/**
 * event_logs 테이블에서 retentionDays 초과 row 를 일괄 삭제.
 * 부팅 시 1회 호출 — 장기 운영 시 디스크/DB 비대를 막는다.
 * 반환값은 삭제된 행 수 (가능한 경우, better-sqlite3 changes()).
 */
export function cleanupOldEventLogs(
  db: Db,
  retentionDays: number,
  nowMs: number = Date.now(),
): number {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(nowMs - retentionDays * 86_400_000);
  try {
    const result = db.delete(eventLogs).where(lt(eventLogs.ts, cutoff)).run();
    return result.changes ?? 0;
  } catch (cause) {
    console.error('[event-logger] cleanup failed', { cause });
    return 0;
  }
}

export function createEventLogger(db: Db): EventLogger {
  return {
    log(entry: EventLogEntry): void {
      const secretKeys = entry.secretKeys ?? DEFAULT_SECRET_KEYS;
      const cleaned = entry.payload ? maskPayload(entry.payload, secretKeys) : null;
      const payloadJson = cleaned === null ? null : JSON.stringify(cleaned);
      const cleanedAudit = entry.audit ? maskPayload(entry.audit, secretKeys) : null;
      const auditPayload = cleanedAudit === null ? null : JSON.stringify(cleanedAudit);
      try {
        db.insert(eventLogs)
          .values({
            ts: new Date(),
            level: entry.level,
            category: entry.category,
            message: entry.message,
            payloadJson,
            auditPayload,
          })
          .run();
      } catch (cause) {
        console.error('[event-logger] insert failed', {
          entry: { level: entry.level, category: entry.category, message: entry.message },
          cause,
        });
      }
    },
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
