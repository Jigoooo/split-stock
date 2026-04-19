import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 파서 모듈을 모킹 — 실제 fetch/zip 파싱 없이 sync 서비스 동작 검증.
const mockDownload = vi.fn();
vi.mock('../kis/stock-master-downloader', () => ({
  KOSPI_MST_URL: 'https://example.test/kospi.zip',
  KOSDAQ_MST_URL: 'https://example.test/kosdaq.zip',
  downloadAndParseMaster: (url: string, market: 'KOSPI' | 'KOSDAQ') => mockDownload(url, market),
}));

import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import { StockMasterRepo } from './stock-master-repo';
import { StockMasterSyncService } from './stock-master-sync';

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  const repo = new StockMasterRepo(db);
  const settings = new SettingsRepo(db);
  const svc = new StockMasterSyncService(repo, settings);
  return { repo, settings, svc };
}

describe('StockMasterSyncService', () => {
  beforeEach(() => {
    mockDownload.mockReset();
  });

  it('sync: KOSPI + KOSDAQ 결과를 sector="KOSPI"/"KOSDAQ"로 upsert', async () => {
    mockDownload.mockImplementation((_url: string, market: 'KOSPI' | 'KOSDAQ') => {
      if (market === 'KOSPI') {
        return Promise.resolve(
          ok([{ pdno: '005930', name: '삼성전자', market: 'KOSPI', groupCode: 'ST' }]),
        );
      }
      return Promise.resolve(
        ok([{ pdno: '035720', name: '카카오', market: 'KOSDAQ', groupCode: 'ST' }]),
      );
    });

    const { repo, svc } = fresh();
    const r = await svc.sync();
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.total).toBe(2);
      expect(r.value.kospi).toBe(1);
      expect(r.value.kosdaq).toBe(1);
    }
    expect(repo.find('005930')?.sector).toBe('KOSPI');
    expect(repo.find('035720')?.sector).toBe('KOSDAQ');
  });

  it('sync: 다운로드 실패 시 DOWNLOAD 오류 반환', async () => {
    mockDownload.mockImplementation(() =>
      Promise.resolve(err({ kind: 'HTTP', msg: 'HTTP 500' })),
    );
    const { svc } = fresh();
    const r = await svc.sync();
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('DOWNLOAD');
      expect(r.error.msg).toMatch(/HTTP 500/);
    }
  });

  it('isStale: 마지막 동기화가 없으면 true', () => {
    const { svc } = fresh();
    expect(svc.isStale()).toBe(true);
  });

  it('isStale: 24h 이내면 false, 초과면 true', () => {
    const { svc, settings } = fresh();
    const now = Date.now();
    settings.set('stock_master.last_sync_at', String(now - 23 * 60 * 60 * 1000));
    expect(svc.isStale(new Date(now))).toBe(false);
    settings.set('stock_master.last_sync_at', String(now - 25 * 60 * 60 * 1000));
    expect(svc.isStale(new Date(now))).toBe(true);
  });

  it('syncIfStale: 이미 최신이면 ok(null) 반환하고 다운로드 스킵', async () => {
    const { svc, settings } = fresh();
    settings.set('stock_master.last_sync_at', String(Date.now()));
    const r = await svc.syncIfStale();
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('sync 성공 후 getLastSyncAt 업데이트', async () => {
    mockDownload.mockImplementation(() => Promise.resolve(ok([])));
    const { svc } = fresh();
    expect(svc.getLastSyncAt()).toBeNull();
    await svc.sync();
    expect(svc.getLastSyncAt()).toBeInstanceOf(Date);
  });
});
