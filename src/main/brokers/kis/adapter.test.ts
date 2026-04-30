import type { AuthService } from '@main/kis/auth';
import { makeKisError } from '@main/kis/errors';
import type { KisHttpClient } from '@main/kis/http-client';
import type { EventLogger } from '@main/logging/event-logger';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { KisAdapter, shouldFallbackKisMockTradingDayToLocal } from './adapter';

describe('KisAdapter trading day fallback', () => {
  it('KIS MOCK 휴장일 서비스 미지원 응답은 공통 KRX 캘린더 verdict 를 유지한다', async () => {
    const logger = { log: vi.fn() };
    const http = {
      get: vi.fn(async () =>
        ok({
          body: {
            rt_cd: '1',
            msg_cd: 'MOCK_NOT_FOUND',
            msg1: '해당 서비스를 찾을수 없습니다.',
          },
        }),
      ),
    };
    const adapter = new KisAdapter({
      authService: {
        getValidToken: vi.fn(async () =>
          ok({ expiresAt: Date.now() + 3_600_000, token: 'token', tokenType: 'Bearer' }),
        ),
      } as unknown as AuthService,
      credentials: {
        accountNo8: '12345678',
        accountProdCd: '01',
        appKey: 'app-key-123456',
        appSecret: 'app-secret-123456',
      },
      env: 'MOCK',
      httpByEnv: { MOCK: http as unknown as KisHttpClient, PROD: http as unknown as KisHttpClient },
      logger: logger as unknown as EventLogger,
      tradingCalendar: {
        getTradingDayStatus: () => ({
          date: '20260430',
          openDay: true,
          openMinute: 540,
          closeMinute: 930,
          source: 'BUNDLED',
          sourceVersion: 'test',
          reason: 'REGULAR',
          confidence: 'MEDIUM',
          stale: false,
          checkedAt: Date.now(),
        }),
      },
    });

    const result = await adapter.isTradingDay(new Date('2026-04-30T10:00:00+09:00'));

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        category: 'ORDER',
        message: 'kis.trading-day.verification-unavailable',
        payload: expect.objectContaining({
          date: '20260430',
          calendarOpenDay: true,
        }),
      }),
    );
  });

  it('PROD 또는 다른 업무 오류는 로컬 fallback 하지 않는다', () => {
    expect(
      shouldFallbackKisMockTradingDayToLocal(
        'MOCK',
        makeKisError('API_BUSINESS', '주문 가능 계좌가 아닙니다.'),
      ),
    ).toBe(false);
    expect(
      shouldFallbackKisMockTradingDayToLocal(
        'PROD',
        makeKisError('API_BUSINESS', '해당 서비스를 찾을수 없습니다.'),
      ),
    ).toBe(false);
  });
});
