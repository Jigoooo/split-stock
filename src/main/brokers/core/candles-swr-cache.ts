/**
 * 차트 캔들 데이터용 Stale-While-Revalidate 인메모리 캐시 (D3).
 *
 * Sub-AC 3.1: chart_swr_cache 개념 구현.
 *
 * 설계 원칙:
 * - 캐시 키: `${pdno}::${period}` (버킷 단위) — 날짜 범위로 파편화하지 않음.
 * - 캐시 히트 시 isStale 여부와 무관하게 즉시 반환 (SWR 패턴).
 * - TTL 경과 후에도 기존 데이터 보존 — 배경 재검증 후 set() 호출 시 갱신.
 * - DailyCandlesRepo 호환 getInRange() 인터페이스 제공 (기존 코드패스 재사용).
 * - now 주입으로 결정론적 테스트 가능.
 *
 * @module candles-swr-cache
 */

import type { ChartPeriod, DailyCandle } from '../../trading/daily-candles-repo';

// ─── 타입 ────────────────────────────────────────────────────────────────────

/** 내부 캐시 엔트리. */
interface CandleSWREntry {
  /** (pdno, period) 버킷의 전체 캔들 배열 (오래된 순 정렬 권장). */
  candles: ReadonlyArray<DailyCandle>;
  /** 데이터 취득 시각 (Date.now() ms). */
  fetchedAt: number;
}

/** get() 반환 값 — SWR 패턴: 항상 데이터 포함, isStale 로 신선도 표시. */
export interface CandleWithMeta {
  /** 요청 범위로 필터된 캔들 (범위 미지정 시 버킷 전체). */
  candles: ReadonlyArray<DailyCandle>;
  /** fetchedAt 기준 TTL 경과 여부. true 여도 캔들은 반환됨 (SWR). */
  isStale: boolean;
  /** 데이터 취득 시각 (ms). UI 에서 "N분 전 데이터" 표시에 활용. */
  fetchedAt: number;
}

export interface CandlesSWRCacheOptions {
  /**
   * 캐시 TTL (ms). 기본 5분.
   * 이 시간 이상 경과 시 isStale=true → 배경 재검증 트리거 신호.
   */
  ttlMs?: number;
  /**
   * 현재 시각 getter. 테스트에서 fake clock 주입.
   * 미지정 시 Date.now() 사용.
   */
  now?: () => number;
}

// ─── 구현 ────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5분

/**
 * 차트 캔들 데이터용 Stale-While-Revalidate 인메모리 캐시.
 *
 * 사용 예:
 * ```ts
 * const cache = new CandlesSWRCache({ ttlMs: 300_000 });
 * cache.set('005930', 'D', candles);
 *
 * const { candles, isStale } = cache.get('005930', 'D') ?? { candles: [], isStale: true, fetchedAt: 0 };
 * if (isStale) void revalidate(); // 배경 재검증 트리거
 * ```
 */
export class CandlesSWRCache {
  private readonly ttlMs: number;
  private readonly getNow: () => number;
  private readonly store = new Map<string, CandleSWREntry>();

  constructor(opts: CandlesSWRCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.getNow = opts.now ?? (() => Date.now());
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private makeKey(pdno: string, period: ChartPeriod): string {
    return `${pdno}::${period}`;
  }

  private checkStale(fetchedAt: number): boolean {
    return this.getNow() - fetchedAt >= this.ttlMs;
  }

  // ─── public ────────────────────────────────────────────────────────────────

  /**
   * 캐시에서 캔들 조회 (SWR 패턴).
   *
   * - 캐시 미스: null 반환.
   * - 캐시 히트: `{ candles, isStale, fetchedAt }` 반환.
   *   isStale=true 여도 캔들 데이터는 포함 — 호출자가 배경 재검증 여부 판단.
   *
   * @param from 조회 시작일 (YYYY-MM-DD). 미지정 시 버킷 전체.
   * @param to   조회 종료일 (YYYY-MM-DD). 미지정 시 버킷 전체.
   */
  get(pdno: string, period: ChartPeriod, from?: string, to?: string): CandleWithMeta | null {
    const entry = this.store.get(this.makeKey(pdno, period));
    if (entry === undefined) return null;

    const isStale = this.checkStale(entry.fetchedAt);

    let candles: ReadonlyArray<DailyCandle> = entry.candles;
    if (from !== undefined || to !== undefined) {
      candles = entry.candles.filter(
        (c) => (from === undefined || c.date >= from) && (to === undefined || c.date <= to),
      );
    }

    return { candles, isStale, fetchedAt: entry.fetchedAt };
  }

  /**
   * 캔들 데이터를 캐시에 저장.
   *
   * @param candles   저장할 캔들 배열 (오래된 순 정렬 권장).
   * @param fetchedAt 데이터 취득 시각 (ms). 미지정 시 현재 시각.
   */
  set(
    pdno: string,
    period: ChartPeriod,
    candles: ReadonlyArray<DailyCandle>,
    fetchedAt?: number,
  ): void {
    this.store.set(this.makeKey(pdno, period), {
      candles,
      fetchedAt: fetchedAt ?? this.getNow(),
    });
  }

  /**
   * DailyCandlesRepo 호환 인터페이스.
   * 기존 `candlesRepo.getInRange()` 콜사이트를 그대로 교체 가능.
   *
   * 캐시 미스 시 빈 배열 반환 (null 대신 — repo 계약 보존).
   */
  getInRange(pdno: string, period: ChartPeriod, from: string, to: string): DailyCandle[] {
    const result = this.get(pdno, period, from, to);
    if (result === null) return [];
    // ReadonlyArray → DailyCandle[] (얕은 복사, repo 계약 준수)
    return result.candles.map((c) => ({ ...c }));
  }

  /**
   * (pdno, period) 버킷이 stale 상태인지 확인.
   * 캐시 미스도 stale 로 간주 (재검증 필요).
   */
  isStale(pdno: string, period: ChartPeriod): boolean {
    const entry = this.store.get(this.makeKey(pdno, period));
    if (entry === undefined) return true;
    return this.checkStale(entry.fetchedAt);
  }

  /** 특정 (pdno, period) 버킷 무효화. 다음 get() 시 null 반환. */
  invalidate(pdno: string, period: ChartPeriod): void {
    this.store.delete(this.makeKey(pdno, period));
  }

  /** 전체 캐시 초기화. */
  clear(): void {
    this.store.clear();
  }
}
