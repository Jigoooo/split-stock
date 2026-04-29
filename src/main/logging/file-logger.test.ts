import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileLogger, rotateOldLogs, summarizeLogDir } from './file-logger';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `split-stock-log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedLog(name: string): string {
  const full = join(tmpDir, name);
  writeFileSync(full, 'sample\n', 'utf8');
  return full;
}

describe('rotateOldLogs', () => {
  it('retentionDays 초과 파일 삭제 + 경계일은 보존', () => {
    seedLog('2026-04-01.log'); // 17일 전
    seedLog('2026-04-15.log'); // 3일 전
    seedLog('2026-04-18.log'); // 오늘
    seedLog('irrelevant.txt'); // 패턴 무시

    const nowMs = Date.UTC(2026, 3, 18); // 2026-04-18
    const remaining = rotateOldLogs(tmpDir, 5, nowMs);

    expect(remaining.map((r) => r.split('/').pop())).toEqual(['2026-04-15.log', '2026-04-18.log']);
    expect(existsSync(join(tmpDir, '2026-04-01.log'))).toBe(false);
    expect(existsSync(join(tmpDir, 'irrelevant.txt'))).toBe(true); // 무시
  });

  it('retentionDays <= 0 → 삭제 없이 모든 매칭 파일 목록만 반환', () => {
    seedLog('2026-04-01.log');
    seedLog('2026-04-18.log');
    const remaining = rotateOldLogs(tmpDir, 0, Date.UTC(2030, 0, 1));
    expect(remaining).toHaveLength(2);
    expect(existsSync(join(tmpDir, '2026-04-01.log'))).toBe(true);
  });

  it('idempotent: 두 번째 호출은 skip', () => {
    seedLog('2026-03-01.log');
    const nowMs = Date.UTC(2026, 3, 18);
    const first = rotateOldLogs(tmpDir, 5, nowMs);
    const second = rotateOldLogs(tmpDir, 5, nowMs);
    expect(first).toEqual(second);
    expect(readdirSync(tmpDir)).toHaveLength(0);
  });

  it('디렉토리 미존재 시 빈 배열', () => {
    expect(rotateOldLogs(join(tmpDir, 'nonexistent'), 5, Date.now())).toEqual([]);
  });
});

describe('createFileLogger', () => {
  it('log() 호출 시 YYYY-MM-DD.log 파일에 append + 마스킹 적용', () => {
    const sink: Array<{ file: string; line: string }> = [];
    const logger = createFileLogger({
      dir: tmpDir,
      now: () => Date.UTC(2026, 3, 18, 9, 30, 15),
      appendFn: (file, line) => sink.push({ file, line }),
    });

    logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'order.cash.request BUY',
      payload: { appKey: 'SUPERSECRETKEY1234', pdno: '005930' },
    });

    expect(sink).toHaveLength(1);
    expect(sink[0]?.file).toBe(join(tmpDir, '2026-04-18.log'));
    expect(sink[0]?.line).toContain('[INFO] [ORDER]');
    expect(sink[0]?.line).toContain('"pdno":"005930"');
    // 마스킹 검증
    expect(sink[0]?.line).not.toContain('SUPERSECRETKEY1234');
    expect(sink[0]?.line).toContain('1234'); // 마지막 4자리 보존
  });

  it('rotate() 호출 시 오래된 로그 삭제 + 남은 목록 반환', () => {
    seedLog('2026-01-01.log');
    seedLog('2026-04-17.log');
    const logger = createFileLogger({
      dir: tmpDir,
      retentionDays: 5,
      now: () => Date.UTC(2026, 3, 18),
      appendFn: () => {},
    });
    const remaining = logger.rotate();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain('2026-04-17.log');
  });

  it('appendFn 예외 던져도 logger는 멈추지 않음', () => {
    const logger = createFileLogger({
      dir: tmpDir,
      appendFn: () => {
        throw new Error('disk full');
      },
    });
    expect(() => logger.log({ level: 'ERROR', category: 'SYS', message: 'boom' })).not.toThrow();
  });

  it('중첩된 api-errors 디렉토리도 자동 생성한다', () => {
    const apiDir = join(tmpDir, 'logs', 'dev', 'api-errors');
    const logger = createFileLogger({
      dir: apiDir,
      now: () => Date.UTC(2026, 3, 18),
    });

    logger.log({ level: 'WARN', category: 'SYS', message: 'api.external.failed' });

    expect(existsSync(join(apiDir, '2026-04-18.log'))).toBe(true);
  });

  it('summarizeLogDir: 파일별 크기 요약', () => {
    writeFileSync(join(tmpDir, '2026-04-18.log'), 'hello world\n', 'utf8');
    const summary = summarizeLogDir(tmpDir);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.bytes).toBeGreaterThan(0);
  });
});
