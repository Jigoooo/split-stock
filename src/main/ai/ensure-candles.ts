import type { BrokerPort } from '../brokers/ports/broker-port';
import type { EventLogger } from '../logging/event-logger';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';

export interface EnsureCandlesInput {
  pdnos: ReadonlyArray<string>;
  candlesRepo: DailyCandlesRepo;
  /**
   * 활성 계좌의 BrokerPort. null 이면 자격증명 미등록 / env mismatch 등으로
   * fetch 시도조차 못함 → skipped=true.
   */
  broker: BrokerPort | null;
  logger: EventLogger;
  /** 최소 캐시 봉 수. 부족하면 broker fetch 트리거. 기본 30. */
  minCount?: number;
}

export interface EnsureCandlesResult {
  /** 새로 받아 적재된 봉 총합 (모든 pdno 합산). */
  fetched: number;
  /** fetch 실패한 pdno 수 (네트워크/권한/상장이전 등). */
  failed: number;
  /** broker 미준비로 fetch 시도조차 못한 경우. */
  skipped: boolean;
}

/**
 * AI 추천 직전 일봉 캐시 부족분을 자동 보충.
 *
 * - cached.length >= minCount 인 pdno 는 건너뜀 (no-op).
 * - 부족한 pdno 만 broker.getDailyOhlcv 1회 호출 → 6 개월(약 120 영업일) chunk 적재.
 * - broker null (미인증/env mismatch) 시 skipped=true 로 silent fallback.
 *
 * Phase 2.5 — 사용자가 차트를 한 번 열어 봉을 받아오는 사전 작업 없이도 추천 동작.
 *
 * Stage 4 변경: KIS 직접 호출(inquireDailyChart) → BrokerPort.getDailyOhlcv 추상.
 * Kiwoom 활성 시에도 동일 로직 재사용.
 */
export async function ensureDailyCandles(input: EnsureCandlesInput): Promise<EnsureCandlesResult> {
  const minCount = input.minCount ?? 30;
  if (!input.broker) {
    return { fetched: 0, failed: 0, skipped: true };
  }

  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  const fromStr = toIsoDate(from);
  const toStr = toIsoDate(to);

  let fetched = 0;
  let failed = 0;
  for (const pdno of input.pdnos) {
    const cached = input.candlesRepo.getInRange(pdno, 'D', fromStr, toStr);
    if (cached.length >= minCount) continue;

    const r = await input.broker.getDailyOhlcv({ symbol: pdno, from, to, period: 'D' });
    if (r.isOk()) {
      input.candlesRepo.upsertMany(pdno, 'D', r.value);
      fetched += r.value.length;
      input.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.ensure-candles.fetched',
        payload: { pdno, count: r.value.length, brokerId: input.broker.brokerId },
      });
    } else {
      failed += 1;
      input.logger.log({
        level: 'WARN',
        category: 'SYS',
        message: 'ai.ensure-candles.fetch-failed',
        payload: { pdno, error: r.error.kind, msg: r.error.msg },
      });
    }
  }
  return { fetched, failed, skipped: false };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
