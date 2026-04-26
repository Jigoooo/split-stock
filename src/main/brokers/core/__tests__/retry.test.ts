import { describe, expect, it, vi } from 'vitest';
import { withExponentialBackoff } from '../retry';

describe('withExponentialBackoff', () => {
  it('첫 시도 성공 시 즉시 반환', async () => {
    const op = vi.fn().mockResolvedValue({ ok: true, value: 42 });
    const r = await withExponentialBackoff(op, {
      maxRetries: 3,
      baseDelayMs: 10,
      retryable: () => true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
    expect(r.stats.attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retryable=true 면 maxRetries 만큼 재시도', async () => {
    const op = vi.fn().mockResolvedValue({ ok: false, error: 'oops' });
    const r = await withExponentialBackoff(op, {
      maxRetries: 2,
      baseDelayMs: 1,
      retryable: () => true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('oops');
    expect(r.stats.attempts).toBe(3); // 0, 1, 2 시도
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('retryable=false 면 첫 실패에서 중단', async () => {
    const op = vi.fn().mockResolvedValue({ ok: false, error: 'fatal' });
    const r = await withExponentialBackoff(op, {
      maxRetries: 5,
      baseDelayMs: 1,
      retryable: () => false,
    });
    expect(r.ok).toBe(false);
    expect(r.stats.attempts).toBe(1);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('onRetry hook 은 retry 직전마다 호출', async () => {
    const op = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'e1' })
      .mockResolvedValueOnce({ ok: false, error: 'e2' })
      .mockResolvedValueOnce({ ok: true, value: 'done' });
    const onRetry = vi.fn();
    const r = await withExponentialBackoff(op, {
      maxRetries: 5,
      baseDelayMs: 1,
      retryable: () => true,
      onRetry,
    });
    expect(r.ok).toBe(true);
    expect(op).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2); // 첫 실패 + 두 번째 실패 직후
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 'e1');
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 'e2');
  });

  it('성공 후 stats.attempts 정확', async () => {
    const op = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'e' })
      .mockResolvedValueOnce({ ok: true, value: 7 });
    const r = await withExponentialBackoff(op, {
      maxRetries: 3,
      baseDelayMs: 1,
      retryable: () => true,
    });
    expect(r.ok).toBe(true);
    expect(r.stats.attempts).toBe(2);
  });
});
