/**
 * Broker-agnostic exponential backoff retry helper.
 *
 * 사용 예:
 *   const r = await withExponentialBackoff(
 *     () => http.post(...),
 *     { maxRetries: 3, baseDelayMs: 200, retryable: (e) => e.kind === 'NETWORK' },
 *   );
 *
 * 현재 KIS auth.ts/order.ts 의 inline 백오프 로직을 일반화한다.
 * Stage 1 시점에는 이 helper 를 사용하는 callsite 가 없다 (dead code) — Stage 2
 * KisAdapter mapper 에서부터 도입한다.
 */

export interface RetryOptions<E> {
  maxRetries: number;
  baseDelayMs: number;
  /** 지수 backoff 의 base. 기본 2 (200ms → 400ms → 800ms). */
  backoffFactor?: number;
  /** 최대 지연. 기본 30s. */
  maxDelayMs?: number;
  /** retry 여부 판정. true 반환 시 재시도. */
  retryable: (err: E) => boolean;
  /** retry 직전 hook (관측용). */
  onRetry?: (attempt: number, err: E) => void;
  /**
   * 커스텀 sleep 구현체. 미주입 시 global setTimeout 사용.
   * 테스트에서 vi.useFakeTimers() 간섭 방지 또는 즉시 resolve 가 필요할 때 주입.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface RetryStats {
  attempts: number;
  totalElapsedMs: number;
}

const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_DELAY_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 지수 백오프 + jitter (full jitter — AWS 권장).
 *
 * 결과:
 *  - 성공: { ok: true, value, stats }
 *  - 모든 시도 실패: { ok: false, error, stats }
 */
export async function withExponentialBackoff<T, E>(
  op: () => Promise<{ ok: true; value: T } | { ok: false; error: E }>,
  options: RetryOptions<E>,
): Promise<({ ok: true; value: T } | { ok: false; error: E }) & { stats: RetryStats }> {
  const start = Date.now();
  const factor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: E | undefined;
  let attemptsTaken = 0;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    attemptsTaken = attempt + 1;
    const r = await op();
    if (r.ok) {
      return { ...r, stats: { attempts: attemptsTaken, totalElapsedMs: Date.now() - start } };
    }
    lastError = r.error;
    if (attempt === options.maxRetries) break;
    if (!options.retryable(r.error)) break;
    options.onRetry?.(attempt + 1, r.error);
    const expDelay = Math.min(options.baseDelayMs * factor ** attempt, maxDelay);
    const jittered = Math.random() * expDelay; // full jitter
    await (options.sleepFn ?? sleep)(jittered);
  }
  return {
    ok: false,
    // biome-ignore lint/style/noNonNullAssertion: 루프 내에서 lastError 가 반드시 set 됨
    error: lastError!,
    stats: { attempts: attemptsTaken, totalElapsedMs: Date.now() - start },
  };
}
