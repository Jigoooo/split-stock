import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EventLogger } from '../logging/event-logger';
import { exportDatabase } from './backup';

const RETENTION_DAYS = 10;
const SCHEDULED_TIMES: Array<{ hour: number; minute: number }> = [
  { hour: 12, minute: 30 },
  { hour: 15, minute: 20 },
];

export interface BackupSchedulerDeps {
  /** DB 원본 경로 */
  dbPath: string;
  /** 백업 파일을 저장할 디렉토리 목록 (첫 번째가 1차, 나머지는 2차 백업) */
  destDirs: string[];
  logger: EventLogger;
  /** 테스트 주입용 — Date.now() 대체 */
  now?: () => number;
  /** 테스트 주입용 — setInterval 대체 */
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** 테스트 주입용 — clearInterval 대체 */
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
}

/**
 * 자동 백업 스케줄러.
 *
 * 트리거:
 *  1. start() 호출 즉시 1회
 *  2. 매일 12:30 (로컬 시각)
 *  3. 매일 15:20 (로컬 시각)
 *
 * 10일 경과 백업 파일 자동 삭제.
 * destDirs[0]: 1차 저장소, destDirs[1+]: 2차(외부) 저장소.
 */
export class BackupScheduler {
  private readonly deps: Required<BackupSchedulerDeps>;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private lastCheckedMinute = -1;

  constructor(deps: BackupSchedulerDeps) {
    this.deps = {
      now: deps.now ?? (() => Date.now()),
      setIntervalFn: deps.setIntervalFn ?? setInterval,
      clearIntervalFn: deps.clearIntervalFn ?? clearInterval,
      dbPath: deps.dbPath,
      destDirs: deps.destDirs,
      logger: deps.logger,
    };
  }

  start(): void {
    if (this.timerId !== null) return;

    // 즉시 1회 실행
    this.runBackup('startup');

    // 30초 간격으로 현재 시각이 트리거 시각과 일치하는지 체크
    this.timerId = this.deps.setIntervalFn(() => {
      this.tick();
    }, 30_000);
  }

  stop(): void {
    if (this.timerId !== null) {
      this.deps.clearIntervalFn(this.timerId);
      this.timerId = null;
    }
    this.lastCheckedMinute = -1;
  }

  /**
   * 외부 트리거 — 차수 수동편집 등 위험 변경 직후 즉시 백업 1회 실행.
   * `lastCheckedMinute` 은 건드리지 않으므로 정시 트리거(12:30/15:20)와 독립.
   */
  triggerNow(reason: string): void {
    this.runBackup(`manual:${reason}`);
  }

  /** 테스트에서 직접 호출 가능 */
  tick(): void {
    const now = new Date(this.deps.now());
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // 같은 분(minute) 내에서 중복 실행 방지
    if (currentMinute === this.lastCheckedMinute) return;

    for (const { hour, minute } of SCHEDULED_TIMES) {
      if (now.getHours() === hour && now.getMinutes() === minute) {
        this.lastCheckedMinute = currentMinute;
        this.runBackup(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
        return;
      }
    }
  }

  private runBackup(trigger: string): void {
    if (!existsSync(this.deps.dbPath)) {
      this.deps.logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'backup.scheduler.db_not_found',
        payload: { trigger, dbPath: this.deps.dbPath },
      });
      return;
    }

    const stamp = new Date(this.deps.now()).toISOString().replace(/[:.]/g, '-');
    const fileName = `split-stock-auto-${stamp}.db`;

    for (const dir of this.deps.destDirs) {
      try {
        mkdirSync(dir, { recursive: true });
        const destPath = join(dir, fileName);
        exportDatabase(this.deps.dbPath, destPath, this.deps.logger);
        this.pruneOldBackups(dir);
      } catch (err) {
        this.deps.logger.log({
          level: 'WARN',
          category: 'SYS',
          message: 'backup.scheduler.write_failed',
          payload: { trigger, dir, error: String(err) },
        });
      }
    }

    this.deps.logger.log({
      level: 'INFO',
      category: 'SYS',
      message: 'backup.scheduler.triggered',
      payload: { trigger, fileName, dirs: this.deps.destDirs.length },
    });
  }

  private pruneOldBackups(dir: string): void {
    if (!existsSync(dir)) return;

    const cutoffMs = this.deps.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const name of readdirSync(dir)) {
      if (!name.startsWith('split-stock-auto-') || !name.endsWith('.db')) continue;

      // 파일명에서 타임스탬프 파싱: split-stock-auto-2026-04-19T03-00-00-000Z.db
      const isoLike = name
        .replace('split-stock-auto-', '')
        .replace('.db', '')
        // 되돌리기: '-' → ':' 단, 날짜 구분자('-')는 유지해야 하므로
        // ISO 형식 재구성: YYYY-MM-DDTHH-MM-SS-mmmZ
        .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/, 'T$1:$2:$3.$4Z');

      const ts = Date.parse(isoLike);
      if (!Number.isNaN(ts) && ts < cutoffMs) {
        try {
          rmSync(join(dir, name));
          pruned++;
        } catch {
          // 삭제 실패는 무시
        }
      }
    }

    if (pruned > 0) {
      this.deps.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'backup.scheduler.pruned',
        payload: { dir, pruned },
      });
    }
  }
}
