import { describe, expect, it, vi } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import type { ChartPeriod, DailyCandle, DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { AiCredentialsRepo, AiProviderConfigWithKey } from './ai-credentials-repo';
import type { DartClient } from './dart-client';
import type { ChatResponse, LlmClient } from './llm-client';
import { type StrategySuggestion, suggestStrategy } from './suggest-strategy';

const config: AiProviderConfigWithKey = {
  id: 1,
  provider: 'openai',
  model: 'test-model',
  apiKeyMasked: 'test****',
  apiKeyPlain: 'test-key',
  isDefault: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function createRepo(count: number): DailyCandlesRepo {
  const candles = buildCandles('2026-01-01', count);
  return {
    getInRange(_pdno: string, _period: ChartPeriod, from: string, to: string): DailyCandle[] {
      return candles.filter((c) => c.date >= from && c.date <= to);
    },
    upsertMany(): number {
      return 0;
    },
  } as unknown as DailyCandlesRepo;
}

function buildCandles(start: string, count: number): DailyCandle[] {
  const out: DailyCandle[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const close = 10_000 + Math.sin(i / 4) * 400;
    out.push({
      date: date.toISOString().slice(0, 10),
      open: close - 80,
      high: close + 160,
      low: close - 160,
      close,
      volume: 200_000 + i * 1000,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

function baseInput(
  candlesRepo: DailyCandlesRepo,
  chat: unknown = vi.fn(),
): Parameters<typeof suggestStrategy>[0] {
  return {
    pdno: '005930',
    candlesRepo,
    stockMasterRepo: { find: () => ({ name: '삼성전자' }) } as unknown as StockMasterRepo,
    aiCredentialsRepo: { getDefaultWithKey: () => config } as unknown as AiCredentialsRepo,
    llmClient: { chat } as unknown as LlmClient,
    dartClient: { isAvailable: () => false } as unknown as DartClient,
    logger: { log: vi.fn() } as unknown as EventLogger,
  };
}

function parsedSuggestion(): StrategySuggestion {
  return {
    maxStages: 5,
    buyRules: [
      { nth: 1, triggerDropPct: 0.05, amountKrw: 100_000 },
      { nth: 2, triggerDropPct: 0.08, amountKrw: 300_000 },
      { nth: 3, triggerDropPct: 0.09, amountKrw: 260_000 },
      { nth: 4, triggerDropPct: 0.1, amountKrw: 240_000 },
      { nth: 5, triggerDropPct: 0.11, amountKrw: 220_000 },
    ],
    sellRules: [
      { nth: 1, targetProfitPct: 0.08 },
      { nth: 2, targetProfitPct: 0.07 },
      { nth: 3, targetProfitPct: 0.06 },
      { nth: 4, targetProfitPct: 0.05 },
      { nth: 5, targetProfitPct: 0.04 },
    ],
    reasoning: '제한 데이터에서는 보수 차수만 허용합니다.',
    stageRationales: [
      { nth: 1, rationale: '1차는 수동 진입', evidenceRefs: ['data:limited'] },
      { nth: 2, rationale: '직전 차수 기준 하락', evidenceRefs: ['data:limited'] },
      { nth: 3, rationale: '최대 3차 제한', evidenceRefs: ['data:limited'] },
    ],
    globalRisks: ['limited data'],
    evidenceRefs: [
      { id: 'made-up', kind: 'news', title: '모델 임의 근거', detail: 'grounded 후보가 아님' },
    ],
    analysisConfidence: 'high',
    dataQuality: 'normal',
  };
}

describe('suggestStrategy', () => {
  it('blocks strategy generation when candle coverage is below 30', async () => {
    const chat = vi.fn();

    const result = await suggestStrategy(baseInput(createRepo(20), chat));

    expect(result.suggestion).toBeNull();
    expect(result.dataQuality).toBe('blocked');
    expect(result.emptyReason).toContain('일봉 캐시가 부족합니다');
    expect(chat).not.toHaveBeenCalled();
  });

  it('caps limited data strategy output before preview application', async () => {
    const chat = vi.fn().mockResolvedValue({
      parsed: parsedSuggestion(),
      text: '{}',
      toolCalls: [],
    } satisfies ChatResponse<StrategySuggestion>);

    const result = await suggestStrategy(baseInput(createRepo(45), chat));

    expect(result.dataQuality).toBe('limited');
    expect(result.suggestion).toMatchObject({
      maxStages: 3,
      analysisConfidence: 'low',
      dataQuality: 'limited',
    });
    expect(result.suggestion?.buyRules).toHaveLength(3);
    expect(result.suggestion?.buyRules[0]?.triggerDropPct).toBeNull();
    expect(result.suggestion?.buyRules[1]?.triggerDropPct).toBeLessThanOrEqual(0.035);
    expect(result.suggestion?.buyRules[1]?.amountKrw).toBeLessThanOrEqual(150_000);
    expect(result.suggestion?.sellRules[0]?.targetProfitPct).toBeLessThanOrEqual(0.04);
    expect(result.suggestion?.evidenceRefs.some((ref) => ref.kind === 'dataQuality')).toBe(true);
    expect(result.suggestion?.evidenceRefs.some((ref) => ref.id === 'made-up')).toBe(false);
  });
});
