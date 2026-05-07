/**
 * CandlesSWRRevalidator — 백그라운드 fresh fetch 트리거 (Sub-AC 3-2-1).
 *
 * 설계 원칙:
 * - triggerRevalidate() 는 fire-and-forget (void 반환).
 * - 동일 (pdno, period) 키 재검증 중이면 중복 fetch 생략 (in-flight dedup).
 * - fetchFn 실패 / ok([]) → 캐시 미갱신, silent WARN/INFO 로그.
 * - pending() 으로 in-flight Promise 노출 → 테스트 결정론적 대기 가능.
 *
 * @module candles-swr-revalidate
 */

import type { Result } from 'neverthrow';
import type { ChartPeriod, DailyCandle } from '../../trading/daily-candles-repo';
import type { CandlesSWRCache } from './candles-swr-cache';

// ─── 타입 ────────────────────────────────────────────────────────────────────

/** fetchFn 반환 타입 — 브로커 에러 종류에 무관하게 수용. */
type FetchResult = Result<readonly DailyCandle[], { kind: string; msg?: string }>;

/** fetchFn 시그니처 — BrokerPort.getDailyOhlcv 등 재사용 가능. */
export type RevalidateFetchFn = () => Promise<FetchResult>;

/** 최소 로거 인터페이스 (EventLogger 구조적 호환). */
interface MinimalLogger {
  log(entry: {
    level: 'INFO' | 'WARN' | 'ERROR';
    category?: string;
    message: string;
    payload?: Record<string, unknown>;
  }): void;
}

// ─── 구현 ────────────────────────────────────────────────────────────────────

/**
 * CandlesSWR 백그라운드 재검증 트리거.
 *
 * 사용 예:
 * ```ts
 * const revalidator = new CandlesSWRRevalidator(cache, logger);
 *
 * // SWR 히트 시 stale 이면 백그라운드 재검증 트리거
 * const cached = cache.get(pdno, period);
 * if (cached?.isStale) {
 *   revalidator.triggerRevalidate(pdno, period, () =>
 *     broker.getDailyOhlcv({ symbol: pdno, from, to }),
 *   );
 * }
 * ```
 */
/** onSuccess 콜백 타입 — fresh candles 도착 시 caller 에게 통지. */
export type CandlesRevalidateSuccessFn = (
  pdno: string,
  period: ChartPeriod,
  candles: readonly DailyCandle[],
) => void;

export class CandlesSWRRevalidator {
  /** in-flight 재검증 Promise 맵. 완료 후 자동 삭제. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly cache: CandlesSWRCache,
    private readonly logger?: MinimalLogger,
    private readonly onSuccess?: CandlesRevalidateSuccessFn,
  ) {}

  // ─── private ───────────────────────────────────────────────────────────────

  private makeKey(pdno: string, period: ChartPeriod): string {
    return `${pdno}::${period}`;
  }

  private async doFetch(
    pdno: string,
    period: ChartPeriod,
    fetchFn: RevalidateFetchFn,
  ): Promise<void> {
    try {
      const result = await fetchFn();

      if (result.isOk()) {
        const candles = result.value;
        if (candles.length === 0) {
          // empty result → 캐시 미갱신, INFO 로그
          this.logger?.log({
            level: 'INFO',
            category: 'SYS',
            message: 'candles-swr-revalidate.empty-result',
            payload: { pdno, period },
          });
          return;
        }
        // 성공 → 캐시 갱신 + onSuccess 콜백 통지
        this.cache.set(pdno, period, candles);
        this.onSuccess?.(pdno, period, candles);
      } else {
        // err Result → WARN 로그, 캐시 미갱신
        this.logger?.log({
          level: 'WARN',
          category: 'SYS',
          message: 'candles-swr-revalidate.fetch-failed',
          payload: {
            pdno,
            period,
            errorKind: result.error.kind,
            errorMsg: result.error.msg,
          },
        });
      }
    } catch (e) {
      // fetchFn throw → WARN 로그, 캐시 미갱신
      this.logger?.log({
        level: 'WARN',
        category: 'SYS',
        message: 'candles-swr-revalidate.fetch-exception',
        payload: {
          pdno,
          period,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  // ─── public ────────────────────────────────────────────────────────────────

  /**
   * 백그라운드 fresh fetch 트리거 (fire-and-forget).
   *
   * - 이미 동일 키 재검증 중이면 중복 호출 무시.
   * - 완료 후 in-flight 슬롯 자동 해제.
   *
   * @param pdno    종목 코드
   * @param period  차트 주기
   * @param fetchFn 신선한 데이터를 가져오는 함수
   */
  triggerRevalidate(pdno: string, period: ChartPeriod, fetchFn: RevalidateFetchFn): void {
    const key = this.makeKey(pdno, period);

    // 이미 재검증 중이면 중복 방지
    if (this.inflight.has(key)) return;

    const promise = this.doFetch(pdno, period, fetchFn).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
  }

  /**
   * 테스트 관측용: 현재 in-flight 재검증 Promise 반환.
   *
   * - 재검증 중이면 Promise 반환 (await 하면 완료 대기 가능).
   * - 재검증 중이 아니면 undefined 반환.
   *
   * @example
   * ```ts
   * revalidator.triggerRevalidate(pdno, period, fetchFn);
   * await revalidator.pending(pdno, period); // 완료까지 대기
   * ```
   */
  pending(pdno: string, period: ChartPeriod): Promise<void> | undefined {
    return this.inflight.get(this.makeKey(pdno, period));
  }
}
