import { describe, expect, it, vi } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { KrxClient } from './krx-client';

const logger = (): EventLogger => ({ log: vi.fn() });

describe('KrxClient', () => {
  it('daily trade endpoint 응답을 캐시 row 계약으로 변환한다', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          OutBlock_1: [
            {
              BAS_DD: '20260428',
              ISU_CD: '5930',
              ISU_NM: '삼성전자',
              TDD_CLSPRC: '72,100',
              CMPPREVDD_PRC: '-300',
              FLUC_RT: '-0.41',
              TDD_OPNPRC: '72,500',
              TDD_HGPRC: '72,700',
              TDD_LWPRC: '71,800',
              ACC_TRDVOL: '12,345,678',
              ACC_TRDVAL: '890,000,000,000',
              MKTCAP: '430,000,000,000,000',
              LIST_SHRS: '5,969,782,550',
            },
            {
              BAS_DD: '20260428',
              ISU_CD: '660',
              ISU_NM: 'SK하이닉스',
              TDD_CLSPRC: '180,000',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new KrxClient({ logger: logger(), apiKey: 'krx-key', fetchImpl });
    const rows = await client.getDailyTradeInfo({
      market: 'KOSPI',
      basDd: '20260428',
      pdnos: ['005930'],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=20260428',
      {
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: 'krx-key',
        },
      },
    );
    expect(rows).toEqual([
      {
        market: 'KOSPI',
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
  });

  it('basic info endpoint 응답을 캐시 row 계약으로 변환한다', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          OutBlock_1: [
            {
              BAS_DD: '20260428',
              ISU_CD: 'KR7005930003',
              ISU_SRT_CD: '005930',
              ISU_NM: '삼성전자',
              ISU_ABBRV: '삼성전자',
              ISU_ENG_NM: 'SamsungElec',
              LIST_DD: '19750611',
              MKT_TP_NM: 'KOSPI',
              SECUGRP_NM: '주권',
              SECT_TP_NM: '전기전자',
              KIND_STKCERT_TP_NM: '보통주',
              PARVAL: '100',
              LIST_SHRS: '5,969,782,550',
            },
            {
              BAS_DD: '20260428',
              ISU_CD: 'KR7000660001',
              ISU_SRT_CD: '000660',
              ISU_NM: 'SK하이닉스',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new KrxClient({ logger: logger(), apiKey: 'krx-key', fetchImpl });
    const rows = await client.getBaseInfo({
      market: 'KOSPI',
      basDd: '20260428',
      pdnos: ['005930'],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info?basDd=20260428',
      {
        headers: {
          'Content-Type': 'application/json',
          AUTH_KEY: 'krx-key',
        },
      },
    );
    expect(rows).toEqual([
      {
        market: 'KOSPI',
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
  });

  it('missing key 상태에서는 외부 호출 없이 실패한다', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new KrxClient({ logger: logger(), apiKey: '', fetchImpl });

    await expect(client.getDailyTradeInfo({ market: 'KOSPI', basDd: '20260428' })).rejects.toThrow(
      'KRX_API_KEY 미설정',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
