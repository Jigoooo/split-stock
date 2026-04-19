import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import {
  downloadAndParseMaster,
  KOSDAQ_MST_URL,
  KOSPI_MST_URL,
} from '../kis/stock-master-downloader';
import type { EventLogger } from '../logging/event-logger';
import type { StockMasterRepo } from './stock-master-repo';

const LAST_SYNC_KEY = 'stock_master.last_sync_at';
const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface SyncSummary {
  total: number;
  kospi: number;
  kosdaq: number;
  syncedAt: Date;
}

export interface SyncError {
  kind: 'DOWNLOAD' | 'PERSIST';
  msg: string;
}

/**
 * KIS 마스터 .mst zip 다운로드 → KOSPI + KOSDAQ 보통주(ST) upsert.
 * - 마지막 동기화 시각을 settings에 기록해 중복 다운로드 회피.
 * - fetch 실패 시 DOWNLOAD 오류, DB 반영 실패 시 PERSIST 오류.
 * - 동시 호출은 in-flight promise로 단일화 (TOCTOU 레이스 방지).
 */
export class StockMasterSyncService {
  private inflight: Promise<Result<SyncSummary, SyncError>> | null = null;

  constructor(
    private readonly repo: StockMasterRepo,
    private readonly settings: SettingsRepo,
  ) {}

  getLastSyncAt(): Date | null {
    const raw = this.settings.get(LAST_SYNC_KEY);
    if (!raw) return null;
    const ms = Number(raw);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms);
  }

  isStale(now: Date = new Date(), minIntervalMs = DEFAULT_MIN_INTERVAL_MS): boolean {
    const last = this.getLastSyncAt();
    if (last === null) return true;
    return now.getTime() - last.getTime() >= minIntervalMs;
  }

  sync(): Promise<Result<SyncSummary, SyncError>> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doSync().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doSync(): Promise<Result<SyncSummary, SyncError>> {
    const kospiResult = await downloadAndParseMaster(KOSPI_MST_URL, 'KOSPI', {
      allowGroupCodes: ['ST'],
    });
    if (kospiResult.isErr()) {
      return err({ kind: 'DOWNLOAD', msg: `KOSPI: ${kospiResult.error.msg}` });
    }
    const kosdaqResult = await downloadAndParseMaster(KOSDAQ_MST_URL, 'KOSDAQ', {
      allowGroupCodes: ['ST'],
    });
    if (kosdaqResult.isErr()) {
      return err({ kind: 'DOWNLOAD', msg: `KOSDAQ: ${kosdaqResult.error.msg}` });
    }

    const now = new Date();
    try {
      // KOSPI/KOSDAQ은 별도 트랜잭션 — 중간 실패 시 KOSPI만 남을 수 있으나
      // upsert는 멱등이므로 다음 sync에서 전부 덮어쓴다. last_sync_at은 둘 다 성공해야만 기록.
      this.repo.upsertMany(
        kospiResult.value.map((e) => ({ pdno: e.pdno, name: e.name, sector: e.market })),
      );
      this.repo.upsertMany(
        kosdaqResult.value.map((e) => ({ pdno: e.pdno, name: e.name, sector: e.market })),
      );
      this.settings.set(LAST_SYNC_KEY, String(now.getTime()));
    } catch (e) {
      return err({ kind: 'PERSIST', msg: e instanceof Error ? e.message : String(e) });
    }

    return ok({
      total: kospiResult.value.length + kosdaqResult.value.length,
      kospi: kospiResult.value.length,
      kosdaq: kosdaqResult.value.length,
      syncedAt: now,
    });
  }

  /** 24시간 초과 시에만 동기화 — 로그인 직후 자동 호출 용도. */
  async syncIfStale(): Promise<Result<SyncSummary | null, SyncError>> {
    if (!this.isStale()) return ok(null);
    return this.sync();
  }

  /**
   * syncIfStale + 로깅 래퍼. 백그라운드 호출처(auth-router, index 부팅)에서
   * 동일한 로그 포맷을 재사용하기 위해 단일 진입점 제공.
   */
  async syncIfStaleWithLog(logger: EventLogger): Promise<void> {
    const r = await this.syncIfStale();
    if (r.isErr()) {
      logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'stockMaster.sync.failed',
        payload: { kind: r.error.kind, msg: r.error.msg },
      });
      return;
    }
    if (r.value) {
      logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'stockMaster.sync.ok',
        payload: { total: r.value.total, kospi: r.value.kospi, kosdaq: r.value.kosdaq },
      });
    }
  }
}
