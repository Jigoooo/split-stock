import { describe, expect, it, vi } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { NaverDatalabClient } from './naver-datalab-client';

function logger(): EventLogger {
  return { log: vi.fn() };
}

describe('NaverDatalabClient', () => {
  it('posts keyword groups in batches of five and summarizes trend ratios', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      calls.push({ url: String(url), init });
      const body = JSON.parse(String(init?.body)) as {
        keywordGroups: Array<{ groupName: string; keywords: string[] }>;
      };
      return new Response(
        JSON.stringify({
          results: body.keywordGroups.map((group, index) => ({
            title: group.groupName,
            keywords: group.keywords,
            data: [
              { period: '2026-04-01', ratio: 10 + index },
              { period: '2026-04-02', ratio: 20 + index },
              { period: '2026-04-03', ratio: 30 + index },
            ],
          })),
        }),
        { status: 200 },
      );
    });
    const client = new NaverDatalabClient({
      logger: logger(),
      naverClientId: 'id',
      naverClientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-04-29T12:00:00+09:00'),
    });

    const result = await client.getTrendSummaries(
      Array.from({ length: 6 }, (_, index) => ({
        key: `00${index}`,
        groupName: `종목${index}`,
        keywords: [`종목${index}`],
      })),
      { days: 30 },
    );

    expect(calls).toHaveLength(2);
    expect(result.get('000')).toMatchObject({
      latestPeriod: '2026-04-03',
      latestRatio: 30,
      previousRatio: 20,
      averageRatio: 20,
      changeFromPrevious: 10,
      changeFromAverage: 10,
      slope: 20,
      startDate: '2026-03-30',
      endDate: '2026-04-28',
    });
    expect(calls[0]?.init?.headers).toMatchObject({
      'X-Naver-Client-Id': 'id',
      'X-Naver-Client-Secret': 'secret',
    });
  });

  it('returns empty map without credentials or usable keywords', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new NaverDatalabClient({
      logger: logger(),
      naverClientId: '',
      naverClientSecret: '',
      fetchImpl,
    });

    await expect(
      client.getTrendSummaries([{ key: '005930', groupName: '삼성전자', keywords: ['삼성전자'] }]),
    ).resolves.toEqual(new Map());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs and skips failed responses', async () => {
    const log = vi.fn();
    const client = new NaverDatalabClient({
      logger: { log },
      naverClientId: 'id',
      naverClientSecret: 'secret',
      fetchImpl: vi.fn<typeof fetch>(async () => new Response('{}', { status: 429 })),
    });

    const result = await client.getTrendSummaries([
      { key: '005930', groupName: '삼성전자', keywords: ['삼성전자'] },
    ]);

    expect(result.size).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'naver-datalab.fetch.failed' }),
    );
  });
});
