import { describe, expect, it, vi } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { EcosClient } from './ecos-client';

const logger = (): EventLogger => ({ log: vi.fn() });

describe('EcosClient', () => {
  it('StatisticSearch 응답을 시계열 캐시 row 계약으로 변환한다', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          StatisticSearch: {
            row: [
              { TIME: '20260427', DATA_VALUE: '1,382.5', UNIT_NAME: '원' },
              { TIME: '20260428', DATA_VALUE: '1381.2', UNIT_NAME: '원' },
            ],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new EcosClient({ logger: logger(), apiKey: 'ecos-key', fetchImpl });
    const rows = await client.getRecentSeries({
      indicator: 'usdKrw',
      statCode: '731Y001',
      itemCode: '0000001',
      frequency: 'D',
      start: '20260401',
      end: '20260428',
      count: 2,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ecos.bok.or.kr/api/StatisticSearch/ecos-key/json/kr/1/2/731Y001/D/20260401/20260428/0000001',
    );
    expect(rows).toEqual([
      {
        indicator: 'usdKrw',
        statCode: '731Y001',
        itemCode: '0000001',
        frequency: 'D',
        date: '20260427',
        value: 1382.5,
        unitName: '원',
      },
      {
        indicator: 'usdKrw',
        statCode: '731Y001',
        itemCode: '0000001',
        frequency: 'D',
        date: '20260428',
        value: 1381.2,
        unitName: '원',
      },
    ]);
  });

  it('missing key 상태에서는 외부 호출 없이 실패한다', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new EcosClient({ logger: logger(), apiKey: '', fetchImpl });

    await expect(
      client.getRecentSeries({
        indicator: 'usdKrw',
        statCode: '731Y001',
        itemCode: '0000001',
        frequency: 'D',
        start: '20260401',
        end: '20260428',
      }),
    ).rejects.toThrow('ECOS_API_KEY 미설정');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('StatisticSearch.row 가 없는 응답은 성공 캐시로 취급하지 않는다', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ RESULT: { CODE: 'INFO-200' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const log = logger();
    const client = new EcosClient({ logger: log, apiKey: 'ecos-key', fetchImpl });

    await expect(
      client.getRecentSeries({
        indicator: 'usdKrw',
        statCode: '731Y001',
        itemCode: '0000001',
        frequency: 'D',
        start: '20260401',
        end: '20260428',
      }),
    ).rejects.toThrow('ECOS 응답에 StatisticSearch.row 없음');
    expect(log.log).toHaveBeenCalledWith(expect.objectContaining({ message: 'ecos.fetch.failed' }));
  });
});
