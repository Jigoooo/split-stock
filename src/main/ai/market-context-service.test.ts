import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { krxBaseInfoCache } from '../db/schema';
import { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import { StockMasterRepo } from '../trading/stock-master-repo';
import type { EcosClient, EcosSeriesRequest } from './ecos-client';
import type { KrxClient } from './krx-client';
import { MarketContextRepo } from './market-context-repo';
import { MarketContextService } from './market-context-service';

const now = () => new Date('2026-04-28T09:00:00+09:00');

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  const settingsRepo = new SettingsRepo(db);
  const stockMasterRepo = new StockMasterRepo(db);
  stockMasterRepo.upsertMany([{ pdno: '005930', name: '삼성전자', sector: 'KOSPI' }]);
  return { db, settingsRepo, stockMasterRepo, repo: new MarketContextRepo(db) };
}

function logger(): EventLogger {
  return { log: vi.fn() };
}

describe('MarketContextService', () => {
  it('missing-key 상태를 status lastError 로 기록하고 insert 하지 않는다', async () => {
    const deps = fresh();
    const service = new MarketContextService({
      ...deps,
      krxClient: { isAvailable: () => false } as unknown as KrxClient,
      ecosClient: { isAvailable: () => false } as unknown as EcosClient,
      logger: logger(),
      now,
    });

    await expect(service.refreshKrxForPdnos(['005930'])).resolves.toEqual({ inserted: 0 });
    await expect(service.refreshDefaultEcosSeries()).resolves.toEqual({ inserted: 0 });

    expect(service.getStatus()).toMatchObject({
      krx: { isAvailable: false, isStale: true, lastError: 'KRX_API_KEY 미설정' },
      ecos: { isAvailable: false, isStale: true, lastError: 'ECOS_API_KEY 미설정' },
    });
  });

  it('성공 refresh 후 stale=false 상태와 최신 cached context 를 반환한다', async () => {
    const deps = fresh();
    const krxClient = {
      isAvailable: () => true,
      getDailyTradeInfo: vi.fn(async () => [
        {
          market: 'KOSPI' as const,
          date: '2026-04-28',
          pdno: '005930',
          name: '삼성전자',
          close: 72100,
          change: -300,
          changeRate: -0.41,
          open: 72500,
          high: 72700,
          low: 71800,
          volume: 12345678,
          tradeValue: 890000000000,
          marketCap: 430000000000000,
          listedShares: 5969782550,
        },
      ]),
      getBaseInfo: vi.fn(async () => [
        {
          market: 'KOSPI' as const,
          date: '2026-04-28',
          isin: 'KR7005930003',
          pdno: '005930',
          name: '삼성전자',
          shortName: '삼성전자',
          englishName: 'SamsungElec',
          listedAt: '1975-06-11',
          marketName: 'KOSPI',
          securityGroup: '주권',
          section: '전기전자',
          stockKind: '보통주',
          parValue: '100',
          listedShares: 5969782550,
        },
      ]),
    } as unknown as KrxClient;
    const ecosClient = {
      isAvailable: () => true,
      getRecentSeries: vi.fn(async (req: EcosSeriesRequest) => [
        {
          indicator: req.indicator,
          statCode: req.statCode,
          itemCode: req.itemCode,
          frequency: req.frequency,
          date: '20260428',
          value: 1381.2,
          unitName: '원',
        },
      ]),
    } as unknown as EcosClient;
    const service = new MarketContextService({
      ...deps,
      krxClient,
      ecosClient,
      logger: logger(),
      now,
    });

    await expect(service.refreshKrxForPdnos(['005930'])).resolves.toEqual({ inserted: 2 });
    await expect(service.refreshDefaultEcosSeries()).resolves.toEqual({ inserted: 2 });
    const snapshot = await service.getContextForPdnos(['005930']);
    const baseInfo = deps.db.select().from(krxBaseInfoCache).all();
    expect(ecosClient.getRecentSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        indicator: 'usdKrw',
        statCode: '731Y001',
        itemCode: '0000001',
        frequency: 'D',
      }),
    );
    expect(ecosClient.getRecentSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        indicator: 'callRate',
        statCode: '817Y002',
        itemCode: '010101000',
        frequency: 'D',
      }),
    );

    expect(snapshot.status.krx).toMatchObject({ isAvailable: true, isStale: false });
    expect(snapshot.status.ecos).toMatchObject({ isAvailable: true, isStale: false });
    expect(snapshot.krxByPdno.get('005930')?.marketCap).toBe(430000000000000);
    expect(baseInfo).toMatchObject([
      {
        market: 'KOSPI',
        pdno: '005930',
        isin: 'KR7005930003',
        marketName: 'KOSPI',
      },
    ]);
    expect(snapshot.ecos.map((p) => p.indicator).sort()).toEqual(['callRate', 'usdKrw']);
  });

  it('API 성공이어도 0건 refresh 는 stale/error 상태로 남긴다', async () => {
    const deps = fresh();
    const service = new MarketContextService({
      ...deps,
      krxClient: {
        isAvailable: () => true,
        getDailyTradeInfo: vi.fn(async () => []),
        getBaseInfo: vi.fn(async () => []),
      } as unknown as KrxClient,
      ecosClient: {
        isAvailable: () => true,
        getRecentSeries: vi.fn(async () => []),
      } as unknown as EcosClient,
      logger: logger(),
      now,
    });

    await expect(service.refreshKrxForPdnos(['005930'])).resolves.toEqual({ inserted: 0 });
    await expect(service.refreshDefaultEcosSeries()).resolves.toEqual({ inserted: 0 });

    expect(service.getStatus()).toMatchObject({
      krx: { isStale: true, lastError: 'KRX 응답 데이터 없음' },
      ecos: { isStale: true, lastError: 'ECOS 응답 데이터 없음' },
    });
  });

  it('refresh 오류를 lastError 로 남기고 이전 성공 캐시를 유지한다', async () => {
    const deps = fresh();
    deps.repo.upsertKrxDailyTrade([
      {
        market: 'KOSPI',
        date: '2026-04-27',
        pdno: '005930',
        name: '삼성전자',
        close: 72000,
        change: null,
        changeRate: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        tradeValue: null,
        marketCap: 420000000000000,
        listedShares: null,
      },
    ]);
    const service = new MarketContextService({
      ...deps,
      krxClient: {
        isAvailable: () => true,
        getDailyTradeInfo: vi.fn(async () => {
          throw new Error('KRX HTTP 500');
        }),
      } as unknown as KrxClient,
      ecosClient: { isAvailable: () => false } as unknown as EcosClient,
      logger: logger(),
      now,
    });

    await expect(service.refreshKrxForPdnos(['005930'])).resolves.toEqual({ inserted: 0 });
    const snapshot = await service.getContextForPdnos(['005930']);

    expect(snapshot.status.krx.lastError).toContain('KRX HTTP 500');
    expect(snapshot.krxByPdno.get('005930')?.marketCap).toBe(420000000000000);
  });

  it('KRX 당일 데이터가 비어 있으면 직전 날짜 캐시로 fallback 한다', async () => {
    const deps = fresh();
    const getDailyTradeInfo = vi.fn(async (req: { basDd: string }) =>
      req.basDd === '20260427'
        ? [
            {
              market: 'KOSPI' as const,
              date: '2026-04-27',
              pdno: '005930',
              name: '삼성전자',
              close: 72000,
              change: null,
              changeRate: null,
              open: null,
              high: null,
              low: null,
              volume: null,
              tradeValue: null,
              marketCap: 420000000000000,
              listedShares: null,
            },
          ]
        : [],
    );
    const getBaseInfo = vi.fn(async (req: { basDd: string }) =>
      req.basDd === '20260427'
        ? [
            {
              market: 'KOSPI' as const,
              date: '2026-04-27',
              isin: 'KR7005930003',
              pdno: '005930',
              name: '삼성전자',
              shortName: '삼성전자',
              englishName: null,
              listedAt: null,
              marketName: 'KOSPI',
              securityGroup: null,
              section: null,
              stockKind: null,
              parValue: null,
              listedShares: null,
            },
          ]
        : [],
    );
    const service = new MarketContextService({
      ...deps,
      krxClient: {
        isAvailable: () => true,
        getDailyTradeInfo,
        getBaseInfo,
      } as unknown as KrxClient,
      ecosClient: { isAvailable: () => false } as unknown as EcosClient,
      logger: logger(),
      now,
    });

    await expect(service.refreshKrxForPdnos(['005930'])).resolves.toEqual({ inserted: 2 });
    const snapshot = await service.getContextForPdnos(['005930']);

    expect(getDailyTradeInfo).toHaveBeenCalledWith(
      expect.objectContaining({ basDd: '20260428', pdnos: ['005930'] }),
    );
    expect(getDailyTradeInfo).toHaveBeenCalledWith(
      expect.objectContaining({ basDd: '20260427', pdnos: ['005930'] }),
    );
    expect(getBaseInfo).toHaveBeenCalledWith(
      expect.objectContaining({ basDd: '20260427', pdnos: ['005930'] }),
    );
    expect(snapshot.status.krx).toMatchObject({ isAvailable: true, isStale: false });
    expect(snapshot.krxByPdno.get('005930')?.date).toBe('2026-04-27');
  });

  it('자동발굴 universe refresh 는 일별매매정보와 기준정보 캐시를 함께 반환한다', async () => {
    const deps = fresh();
    const getDailyTradeInfo = vi.fn(async () => [
      {
        market: 'KOSPI' as const,
        date: '2026-04-28',
        pdno: '005930',
        name: '삼성전자',
        close: 72100,
        change: -300,
        changeRate: -0.41,
        open: 72500,
        high: 72700,
        low: 71800,
        volume: 12345678,
        tradeValue: 890000000000,
        marketCap: 430000000000000,
        listedShares: 5969782550,
      },
    ]);
    const getBaseInfo = vi.fn(async () => [
      {
        market: 'KOSPI' as const,
        date: '2026-04-28',
        isin: 'KR7005930003',
        pdno: '005930',
        name: '삼성전자',
        shortName: '삼성전자',
        englishName: 'SamsungElec',
        listedAt: '1975-06-11',
        marketName: 'KOSPI',
        securityGroup: '주권',
        section: '전기전자',
        stockKind: '보통주',
        parValue: '100',
        listedShares: 5969782550,
      },
    ]);
    const service = new MarketContextService({
      ...deps,
      krxClient: {
        isAvailable: () => true,
        getDailyTradeInfo,
        getBaseInfo,
      } as unknown as KrxClient,
      ecosClient: { isAvailable: () => false } as unknown as EcosClient,
      logger: logger(),
      now,
    });

    const snapshot = await service.getKrxUniverseForAutoDiscovery(['KOSPI']);

    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.baseInfoByKey.get('KOSPI:005930')).toMatchObject({
      pdno: '005930',
      stockKind: '보통주',
      securityGroup: '주권',
    });
    expect(getDailyTradeInfo).toHaveBeenCalledWith(
      expect.objectContaining({ market: 'KOSPI', basDd: '20260428' }),
    );
    expect(getBaseInfo).toHaveBeenCalledWith(
      expect.objectContaining({ market: 'KOSPI', basDd: '20260428' }),
    );
  });

  it('자동발굴 universe 는 개별 종목 캐시 1건을 full universe cache 로 오해하지 않는다', async () => {
    const deps = fresh();
    deps.settingsRepo.set('market_context.krx.last_success_at', String(now().getTime()));
    deps.repo.upsertKrxDailyTrade([
      {
        market: 'KOSPI',
        date: '2026-04-27',
        pdno: '005930',
        name: '삼성전자',
        close: 72000,
        change: null,
        changeRate: null,
        open: null,
        high: null,
        low: null,
        volume: 1000000,
        tradeValue: 100000000000,
        marketCap: 420000000000000,
        listedShares: null,
      },
    ]);
    const getDailyTradeInfo = vi.fn(async () => [
      {
        market: 'KOSPI' as const,
        date: '2026-04-28',
        pdno: '005930',
        name: '삼성전자',
        close: 72100,
        change: null,
        changeRate: null,
        open: null,
        high: null,
        low: null,
        volume: 1000000,
        tradeValue: 100000000000,
        marketCap: 430000000000000,
        listedShares: null,
      },
      {
        market: 'KOSPI' as const,
        date: '2026-04-28',
        pdno: '000660',
        name: 'SK하이닉스',
        close: 180000,
        change: null,
        changeRate: null,
        open: null,
        high: null,
        low: null,
        volume: 900000,
        tradeValue: 160000000000,
        marketCap: 130000000000000,
        listedShares: null,
      },
    ]);
    const log = vi.fn();
    const service = new MarketContextService({
      ...deps,
      krxClient: {
        isAvailable: () => true,
        getDailyTradeInfo,
        getBaseInfo: vi.fn(async () => []),
      } as unknown as KrxClient,
      ecosClient: { isAvailable: () => false } as unknown as EcosClient,
      logger: { log },
      now,
    });

    const snapshot = await service.getKrxUniverseForAutoDiscovery(['KOSPI']);

    expect(getDailyTradeInfo).toHaveBeenCalled();
    expect(snapshot.rows.map((row) => row.pdno).sort()).toEqual(['000660', '005930']);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'market-context.krx.universe-cache-insufficient-refreshing',
        payload: expect.objectContaining({ counts: { KOSPI: 1 } }),
      }),
    );
  });
});
