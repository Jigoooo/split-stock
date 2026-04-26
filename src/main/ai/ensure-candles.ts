import type { AppEnv } from '@shared/contracts';
import type { AuthService } from '../kis/auth';
import { inquireDailyChart } from '../kis/domestic-stock';
import type { KisHttpClient } from '../kis/http-client';
import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';

export interface EnsureCandlesInput {
  pdnos: ReadonlyArray<string>;
  candlesRepo: DailyCandlesRepo;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  auth: AuthService;
  credentialsRepo: CredentialsRepo;
  env: AppEnv;
  logger: EventLogger;
  /** 최소 캐시 봉 수. 부족하면 KIS fetch 트리거. 기본 30. */
  minCount?: number;
}

export interface EnsureCandlesResult {
  /** 새로 받아 적재된 봉 총합 (모든 pdno 합산). */
  fetched: number;
  /** fetch 실패한 pdno 수 (네트워크/권한/상장이전 등). */
  failed: number;
  /** 자격증명/토큰 미준비로 fetch 시도조차 못한 경우. */
  skipped: boolean;
}

/**
 * AI 추천 직전 일봉 캐시 부족분을 자동 보충.
 *
 * - cached.length >= minCount 인 pdno 는 건너뜀 (no-op).
 * - 부족한 pdno 만 KIS inquireDailyChart 1회 호출 → 6개월(약 120영업일) chunk 적재.
 * - 자격증명/토큰 실패 시 skipped=true 로 silent fallback (사용자에게는 "데이터 부족" 안내가
 *   suggest-symbols / suggest-strategy 에서 표시됨).
 *
 * Phase 2.5 — 사용자가 차트를 한 번 열어 봉을 받아오는 사전 작업 없이도 추천 동작.
 */
export async function ensureDailyCandles(input: EnsureCandlesInput): Promise<EnsureCandlesResult> {
  const minCount = input.minCount ?? 30;
  const credResult = input.credentialsRepo.loadCredentialsByEnv(input.env);
  if (credResult.isErr() || !credResult.value) {
    return { fetched: 0, failed: 0, skipped: true };
  }
  const cred = credResult.value;
  const tokenResult = await input.auth.getValidToken(input.env, cred.appKey, cred.appSecret);
  if (tokenResult.isErr()) {
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

    const r = await inquireDailyChart(
      {
        http: input.httpByEnv[input.env],
        env: input.env,
        token: tokenResult.value.token,
        appKey: cred.appKey,
        appSecret: cred.appSecret,
      },
      { code: pdno, from, to, period: 'D' },
    );
    if (r.isOk()) {
      input.candlesRepo.upsertMany(pdno, 'D', r.value);
      fetched += r.value.length;
      input.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.ensure-candles.fetched',
        payload: { pdno, count: r.value.length, env: input.env },
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
