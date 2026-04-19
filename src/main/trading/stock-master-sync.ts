import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import {
  downloadAndParseMaster,
  KOSDAQ_MST_URL,
  KOSPI_MST_URL,
} from '../kis/stock-master-downloader';
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
 */
export class StockMasterSyncService {
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

  async sync(): Promise<Result<SyncSummary, SyncError>> {
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
}
