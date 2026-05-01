import Bottleneck from 'bottleneck';

export type UpbitRateLimitGroup =
  | 'market'
  | 'candle'
  | 'trade'
  | 'ticker'
  | 'orderbook'
  | 'exchange-default'
  | 'order'
  | 'order-test'
  | 'order-cancel-all'
  | 'websocket-connect'
  | 'websocket-message';

function limiterFor(group: UpbitRateLimitGroup): Bottleneck {
  if (group === 'order-cancel-all') {
    return new Bottleneck({ minTime: 2000, maxConcurrent: 1 });
  }
  if (group === 'order' || group === 'order-test') {
    return new Bottleneck({ minTime: 125, maxConcurrent: 1 });
  }
  if (group === 'exchange-default') {
    return new Bottleneck({ minTime: 34, maxConcurrent: 1 });
  }
  if (group === 'websocket-connect' || group === 'websocket-message') {
    return new Bottleneck({ minTime: 200, maxConcurrent: 1 });
  }
  return new Bottleneck({ minTime: 100, maxConcurrent: 1 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMsFromCause(cause: unknown): number | null {
  const maybe = cause as { headers?: { get?: (key: string) => string | null }; status?: number };
  const retryAfter = maybe.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  if (maybe.status === 418) return 60_000;
  if (maybe.status === 429) return 1_000;
  return null;
}

export class UpbitRateLimiter {
  private readonly limiters = new Map<UpbitRateLimitGroup, Bottleneck>();
  private readonly cooldownUntil = new Map<UpbitRateLimitGroup, number>();

  penalize(group: UpbitRateLimitGroup, retryAfterMs: number): void {
    if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return;
    const until = Date.now() + retryAfterMs;
    this.cooldownUntil.set(group, Math.max(this.cooldownUntil.get(group) ?? 0, until));
  }

  async schedule<T>(group: UpbitRateLimitGroup, task: () => Promise<T>): Promise<T> {
    let limiter = this.limiters.get(group);
    if (!limiter) {
      limiter = limiterFor(group);
      this.limiters.set(group, limiter);
    }
    const cooldownMs = (this.cooldownUntil.get(group) ?? 0) - Date.now();
    if (cooldownMs > 0) await sleep(cooldownMs);
    return limiter.schedule(async () => {
      try {
        return await task();
      } catch (cause) {
        const retryAfterMs = retryAfterMsFromCause(cause);
        if (retryAfterMs !== null) this.penalize(group, retryAfterMs);
        throw cause;
      }
    });
  }
}

export const sharedUpbitRateLimiter = new UpbitRateLimiter();
