import { describe, expect, it } from 'vitest';
import { parseKiwoomExpiry } from '../auth';

describe('parseKiwoomExpiry', () => {
  it('YYYYMMDDHHMMSS (KST) 를 epoch ms 로 변환 — UTC+9 보정', () => {
    // 2026-04-26 17:35:00 KST = 2026-04-26 08:35:00 UTC
    const ms = parseKiwoomExpiry('20260426173500');
    expect(ms).toBe(Date.UTC(2026, 3, 26, 8, 35, 0));
  });

  it('형식 불일치 (length !== 14) 시 fallback — 현재 시각 + 23h', () => {
    const before = Date.now();
    const ms = parseKiwoomExpiry('invalid');
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(after + 23 * 60 * 60 * 1000 + 100);
  });
});

describe('classifyKiwoomBody (return_code 분류)', () => {
  it('정상 응답 (return_code === 0) → null', async () => {
    const { classifyKiwoomBody } = await import('../errors');
    const r = classifyKiwoomBody(200, { return_code: 0, return_msg: 'OK' });
    expect(r).toBeNull();
  });

  it('return_msg 에 "토큰 만료" → AUTH_FAILED', async () => {
    const { classifyKiwoomBody } = await import('../errors');
    const r = classifyKiwoomBody(401, { return_code: 1, return_msg: '토큰이 만료되었습니다' });
    expect(r?.kind).toBe('AUTH_FAILED');
    expect(r?.brokerId).toBe('KIWOOM');
  });

  it('HTTP 429 → RATE_LIMITED', async () => {
    const { classifyKiwoomBody } = await import('../errors');
    const r = classifyKiwoomBody(429, { return_code: 1, return_msg: 'rate limited' });
    expect(r?.kind).toBe('RATE_LIMITED');
  });

  it('5xx → NETWORK', async () => {
    const { classifyKiwoomBody } = await import('../errors');
    const r = classifyKiwoomBody(500, { return_code: 1, return_msg: '서버 오류' });
    expect(r?.kind).toBe('NETWORK');
  });

  it('4xx 기타 → BUSINESS, return_code 가 raw.code 에 보존', async () => {
    const { classifyKiwoomBody } = await import('../errors');
    const r = classifyKiwoomBody(400, { return_code: '8123', return_msg: 'invalid params' });
    expect(r?.kind).toBe('BUSINESS');
    expect(r?.raw?.code).toBe('8123');
  });
});
