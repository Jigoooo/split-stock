/**
 * KisAdapter.getDailyOhlcv 재시도(retry) 동작 테스트.
 *
 * Sub-AC 1: 5xx / timeout(NETWORK 에러) 시 200ms→600ms→1.8s 간격으로
 * 최대 3회 자동 재시도. BUSINESS/VALIDATION 등 non-NETWORK 에러는 즉시 반환.
 *
 * HTTP 레이어를 직접 모킹해 실제 inquireDailyChart 코드패스를 경유,
 * adapter ↔ withExponentialBackoff ↔ http.get 전 스택을 통합 검증한다.
 *
 * 테스트 내 지연 시간 단축: ohlcvRetryBaseDelayMs=1 옵션 사용.
 */

import type { AuthService } from '@main/kis/auth';
import type { KisHttpClient } from '@main/kis/http-client';
import type { EventLogger } from '@main/logging/event-logger';
import { err as nerr, ok as nok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KisAdapter } from '../adapter';

// ─── 공통 픽스처 ────────────────────────────────────────────────────────────

/** HTTP 503 / timeout 모사 — inquireDailyChart 가 KisError{kind:'NETWORK'} 반환 */
const NETWORK_ERR = nerr({ kind: 'NETWORK' as const, msg: 'HTTP 503 timeout' });

/** 정상 일봉 응답 (빈 output2) */
const CHART_OK = nok({ body: { rt_cd: '0', msg_cd: 'KIOK', msg1: 'success', output2: [] } });

/** 비즈니스 오류 응답 (rt_cd='1') — BUSINESS 에러로 변환됨 */
const BUSINESS_ERR = nok({
  body: { rt_cd: '1', msg_cd: 'EBIZ', msg1: '업무 처리 오류', output2: [] },
});

function makeAdapter(httpGet: ReturnType<typeof vi.fn>) {
  const http = { get: httpGet, post: vi.fn() } as unknown as KisHttpClient;
  return new KisAdapter({
    env: 'MOCK',
    authService: {
      getValidToken: vi.fn(async () =>
        nok({ expiresAt: Date.now() + 3_600_000, token: 'test-token', tokenType: 'Bearer' }),
      ),
    } as unknown as AuthService,
    credentials: {
      accountNo8: '12345678',
      accountProdCd: '01',
      appKey: 'app-key-test',
      appSecret: 'app-secret-test',
    },
    httpByEnv: { MOCK: http, PROD: http },
    logger: { log: vi.fn() } as unknown as EventLogger,
    tradingCalendar: { getTradingDayStatus: vi.fn() },
    ohlcvRetryBaseDelayMs: 1, // 테스트 속도 최적화 (실제 200ms 대신 1ms)
  });
}

const PARAMS = {
  symbol: '005930' as const,
  from: new Date('2025-01-01'),
  to: new Date('2025-01-31'),
};

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('KisAdapter.getDailyOhlcv — 자동 재시도', () => {
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    httpGet = vi.fn();
  });

  it('NETWORK 에러 시 최대 3회 재시도 — 총 4회 호출', async () => {
    httpGet.mockResolvedValue(NETWORK_ERR);
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('NETWORK');
      expect(r.error.brokerId).toBe('KIS');
    }
    // 초기 1회 + 재시도 3회 = 총 4회
    expect(httpGet).toHaveBeenCalledTimes(4);
  });

  it('2번째 시도에서 성공하면 이후 재시도 없이 결과 반환', async () => {
    httpGet.mockResolvedValueOnce(NETWORK_ERR).mockResolvedValue(CHART_OK);
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isOk()).toBe(true);
    expect(httpGet).toHaveBeenCalledTimes(2); // 실패 1회 + 성공 1회
  });

  it('3번째 시도에서 성공하면 재시도 완료', async () => {
    httpGet
      .mockResolvedValueOnce(NETWORK_ERR)
      .mockResolvedValueOnce(NETWORK_ERR)
      .mockResolvedValue(CHART_OK);
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isOk()).toBe(true);
    expect(httpGet).toHaveBeenCalledTimes(3);
  });

  it('BUSINESS 에러(rt_cd≠0)는 재시도하지 않고 즉시 에러 반환', async () => {
    httpGet.mockResolvedValue(BUSINESS_ERR);
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('BUSINESS');
    }
    expect(httpGet).toHaveBeenCalledTimes(1); // 재시도 없음
  });

  it('첫 번째 시도에 성공하면 재시도 없음', async () => {
    httpGet.mockResolvedValue(CHART_OK);
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isOk()).toBe(true);
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('AUTH_FAILED 에러는 재시도하지 않음', async () => {
    httpGet.mockResolvedValue(nerr({ kind: 'AUTH_FAILED' as const, msg: '토큰 만료' }));
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('AUTH_FAILED');
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('RATE_LIMITED 에러는 재시도하지 않음 (별도 rate-limit 정책 보존)', async () => {
    httpGet.mockResolvedValue(nerr({ kind: 'RATE_LIMITED' as const, msg: '한도 초과' }));
    const adapter = makeAdapter(httpGet);

    const r = await adapter.getDailyOhlcv(PARAMS);

    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('RATE_LIMITED');
    expect(httpGet).toHaveBeenCalledTimes(1);
  });
});
