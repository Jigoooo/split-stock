import { createHash } from 'node:crypto';
import type { Db } from '../db/client';
import { eventLogs } from '../db/schema';
import { maskSecret } from '../security/mask-secret';

export type EventLevel = 'INFO' | 'WARN' | 'ERROR';
export type EventCategory = 'AUTH' | 'ORDER' | 'FSM' | 'WS' | 'SYS';

export interface EventLogEntry {
  level: EventLevel;
  category: EventCategory;
  message: string;
  payload?: Record<string, unknown>;
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
export function createEventLogger(db: Db): EventLogger {
  return {
    log(entry: EventLogEntry): void {
      const cleaned = entry.payload
        ? maskPayload(entry.payload, entry.secretKeys ?? DEFAULT_SECRET_KEYS)
        : null;
      const payloadJson = cleaned === null ? null : JSON.stringify(cleaned);
      try {
        db.insert(eventLogs)
          .values({
            ts: new Date(),
            level: entry.level,
            category: entry.category,
            message: entry.message,
            payloadJson,
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
