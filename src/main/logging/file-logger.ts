import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { EventLogEntry, EventLogger } from './event-logger';
import { maskPayload } from './event-logger';

export interface FileLoggerOptions {
  dir: string;
  /** 보존 일수 (기본 40). 0 이하면 로테이션 skip. */
  retentionDays?: number;
  /** Date.now 주입 — 테스트용. */
  now?: () => number;
  /** 파일 append 핸들러 주입 — 테스트는 메모리 sink. */
  appendFn?: (filePath: string, line: string) => void;
}

export interface FileLogger extends EventLogger {
  currentFile(): string;
  rotate(now?: number): string[];
}

const FILENAME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.log$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatLine(entry: EventLogEntry, ts: number): string {
  const cleaned = entry.payload ? maskPayload(entry.payload, entry.secretKeys) : null;
  const payloadPart = cleaned === null ? '' : ` ${JSON.stringify(cleaned)}`;
  return `${new Date(ts).toISOString()} [${entry.level}] [${entry.category}] ${entry.message}${payloadPart}\n`;
}

function defaultAppend(filePath: string, line: string): void {
  appendFileSync(filePath, line, 'utf8');
}

/**
 * 파일 기반 EventLogger — 일자별 파일(YYYY-MM-DD.log) append.
 * - 쓰기 실패는 throw하지 않음 (호출측 서비스가 멈추지 않도록)
 * - payload는 maskPayload로 자동 스크러빙 (DB logger와 동일 규칙)
 */
export function createFileLogger(opts: FileLoggerOptions): FileLogger {
  const now = opts.now ?? (() => Date.now());
  const dir = opts.dir;
  const append = opts.appendFn ?? defaultAppend;

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const currentFile = (): string => join(dir, `${toDateStr(now())}.log`);

  return {
    currentFile,

    log(entry: EventLogEntry): void {
      try {
        append(currentFile(), formatLine(entry, now()));
      } catch {
        // 파일 로거 실패는 의도적으로 swallow (DB logger 등과 독립 동작)
      }
    },

    rotate(atMs?: number): string[] {
      return rotateOldLogs(dir, opts.retentionDays ?? 40, atMs ?? now());
    },
  };
}

/**
 * YYYY-MM-DD.log 파일 중 retentionDays 초과분 삭제.
 * - 순수 함수(결정적), idempotent
 * - now는 기준 시각(ms) — 테스트는 명시적으로 주입
 * - 남은 파일 경로 목록 반환(정렬됨)
 */
export function rotateOldLogs(dir: string, retentionDays: number, nowMs: number): string[] {
  if (!existsSync(dir)) return [];
  const all = readdirSync(dir).filter((f) => FILENAME_PATTERN.test(f));
  if (retentionDays <= 0) {
    return all.map((f) => join(dir, f)).sort();
  }
  const cutoffMs = nowMs - retentionDays * 86_400_000;
  const remaining: string[] = [];
  for (const name of all) {
    const m = FILENAME_PATTERN.exec(name);
    if (!m) continue;
    const [, year, month, day] = m;
    const fileDayMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const full = join(dir, name);
    if (fileDayMs < cutoffMs) {
      try {
        unlinkSync(full);
      } catch {
        // already deleted — idempotent
      }
    } else {
      remaining.push(full);
    }
  }
  return remaining.sort();
}

export function summarizeLogDir(dir: string): Array<{ file: string; bytes: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => FILENAME_PATTERN.test(f))
    .map((f) => {
      const full = join(dir, f);
      try {
        return { file: full, bytes: statSync(full).size };
      } catch {
        return { file: full, bytes: 0 };
      }
    });
}
