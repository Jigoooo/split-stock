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
  'token',
  'access_token',
  'password',
  'authorization',
] as const;

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
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (secretKeys.includes(k) && typeof v === 'string') {
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
