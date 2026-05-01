import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { UpbitRateLimiter } from './rate-limiter';

describe('UpbitRateLimiter', () => {
  it('holds a group while a rate-limit penalty cooldown is active', async () => {
    const limiter = new UpbitRateLimiter();
    limiter.penalize('ticker', 20);

    const startedAt = performance.now();
    await limiter.schedule('ticker', async () => 'ok');

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(15);
  });
});
