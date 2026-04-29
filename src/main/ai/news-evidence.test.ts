import { describe, expect, it } from 'vitest';
import { collectNewsEvidence, formatNewsEvidenceForPrompt } from './news-evidence';
import type { NewsItem, NewsSearchOptions } from './news-fetcher';

describe('news evidence', () => {
  it('uses bounded query/sort budget and clusters duplicate news', async () => {
    const calls: NewsSearchOptions[] = [];
    const search = async (options: NewsSearchOptions): Promise<NewsItem[]> => {
      calls.push(options);
      return [
        {
          publishedAt: '2026-04-29 09:00',
          title: '삼성전자 실적 개선 기대',
          summary: '반도체 업황 개선 기대',
          link: `https://news.example/${options.query}/${options.sort}/1`,
        },
        {
          publishedAt: '2026-04-29 08:30',
          title: '삼성전자, 실적 개선 기대감',
          summary: '유사한 실적 개선 기사',
          link: `https://news.example/${options.query}/${options.sort}/2`,
        },
      ];
    };

    const pack = await collectNewsEvidence({
      pdno: '005930',
      name: '삼성전자',
      search,
    });

    expect(calls).toHaveLength(12);
    expect(calls.every((call) => call.display === 30 && call.start === 1)).toBe(true);
    expect(new Set(calls.map((call) => call.sort))).toEqual(new Set(['date', 'sim']));
    expect(pack.rawCount).toBe(24);
    expect(pack.clusters.length).toBeLessThanOrEqual(8);
    expect(pack.clusters[0]?.representative.length).toBeLessThanOrEqual(2);
  });

  it('formats prompt evidence within the requested character cap', async () => {
    const pack = await collectNewsEvidence({
      pdno: '000001',
      name: '테스트',
      search: async () => [
        {
          publishedAt: '2026-04-29 09:00',
          title: '긴 제목'.repeat(80),
          summary: '긴 요약'.repeat(120),
          link: 'https://news.example/a',
        },
      ],
    });

    const prompt = formatNewsEvidenceForPrompt(pack, 240);
    expect(prompt.length).toBeLessThanOrEqual(240);
    expect(prompt).toContain('뉴스 evidence');
  });
});
