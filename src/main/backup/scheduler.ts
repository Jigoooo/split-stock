import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_AUTO_DEFAULTS,
  readBackupAutoConfig,
  SETTING_KEYS,
  type SettingsRepo,
} from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import { exportDatabase } from './backup';

const SCHEDULED_TIMES: Array<{ hour: number; minute: number }> = [
  { hour: 12, minute: 30 },
  { hour: 15, minute: 20 },
];

export interface BackupSchedulerDeps {
  /** DB 원본 경로 */
  dbPath: string;
  /** 백업 파일을 저장할 1차 디렉토리. 2차 경로(duplicate)는 settingsRepo에서 runtime read. */
  destDirs: string[];
  logger: EventLogger;
  /** 자동 백업 enabled / retentionDays / duplicate 경로 runtime 조회용 (optional — 미주입 시 enabled=true, retention=10). */
  settingsRepo?: SettingsRepo;
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
 *  1. start() 호출 즉시 1회 (autoBackupEnabled=true 일 때만)
 *  2. 매일 12:30 (로컬 시각)
 *  3. 매일 15:20 (로컬 시각)
 *
 * 보관 일수 경과 백업 파일 자동 삭제. 보관일수는 settingsRepo runtime read.
 * destDirs[0]: 1차 저장소. settingsRepo의 BACKUP_DUPLICATE_PATH는 runtime에 추가 destDir로 합산.
 *
 * start() / stop() 멱등성 — 같은 상태에서 다시 호출해도 안전.
 */
export class BackupScheduler {
  private readonly deps: Required<Omit<BackupSchedulerDeps, 'settingsRepo'>> & {
    settingsRepo: SettingsRepo | null;
  };
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
      settingsRepo: deps.settingsRepo ?? null,
    };
  }

  /** 자동 백업 활성 여부. settingsRepo 미주입 시 true(기존 동작 유지). */
  private isEnabled(): boolean {
    if (!this.deps.settingsRepo) return BACKUP_AUTO_DEFAULTS.enabled;
    return readBackupAutoConfig(this.deps.settingsRepo).enabled;
  }

  /** 보관 일수. settingsRepo 미주입 시 기본값. */
  private getRetentionDays(): number {
    if (!this.deps.settingsRepo) return BACKUP_AUTO_DEFAULTS.retentionDays;
    return readBackupAutoConfig(this.deps.settingsRepo).retentionDays;
  }

  /** 백업 시점에 사용할 디렉토리 목록 — primary + duplicate(설정된 경우). */
  private getEffectiveDestDirs(): string[] {
    if (!this.deps.settingsRepo) return this.deps.destDirs;
    const duplicate = this.deps.settingsRepo.get(SETTING_KEYS.BACKUP_DUPLICATE_PATH);
    return duplicate ? [...this.deps.destDirs, duplicate] : this.deps.destDirs;
  }

  start(): void {
    if (this.timerId !== null) return;

    if (!this.isEnabled()) {
      this.deps.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'backup.scheduler.skipped',
        payload: { reason: 'auto_backup_disabled' },
      });
      return;
    }

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
   * autoBackupEnabled=false 라도 사용자 명시 변경에 대한 안전 백업이므로 실행.
   */
  triggerNow(reason: string): void {
    this.runBackup(`manual:${reason}`);
  }

  /** 테스트에서 직접 호출 가능 */
  tick(): void {
    if (!this.isEnabled()) return;

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
    const destDirs = this.getEffectiveDestDirs();

    for (const dir of destDirs) {
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
      payload: { trigger, fileName, dirs: destDirs.length },
    });
  }

  private pruneOldBackups(dir: string): void {
    if (!existsSync(dir)) return;

    const retentionDays = this.getRetentionDays();
    const cutoffMs = this.deps.now() - retentionDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const name of readdirSync(dir)) {
      if (!name.startsWith('split-stock-auto-') || !name.endsWith('.db')) continue;

      const isoLike = name
        .replace('split-stock-auto-', '')
        .replace('.db', '')
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
