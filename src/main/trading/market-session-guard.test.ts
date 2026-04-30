import { describe, expect, it, vi } from 'vitest';
import { FakeBrokerAdapter } from '../brokers/__tests__/fake-broker-adapter';
import { AutoOrderBlockedError } from './auto-order-errors';
import { MarketSessionGuard } from './market-session-guard';

function createGuard(broker: FakeBrokerAdapter | null, now: Date) {
  const logger = { log: vi.fn() };
  const guard = new MarketSessionGuard({
    getBroker: () => broker,
    logger: logger as never,
    now: () => now,
  });
  return { guard, logger };
}

describe('MarketSessionGuard', () => {
  it('주말에는 broker 호출 전에 자동주문을 차단한다', async () => {
    const broker = new FakeBrokerAdapter();
    const { guard } = createGuard(broker, new Date('2026-04-25T14:05:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'SELL',
        source: 'STRATEGY',
      }),
    ).rejects.toMatchObject({ code: 'MARKET_WEEKEND' });
    expect(broker.callCount.getTradingDayStatus).toBe(0);
  });

  it('정규장 시간이 아니면 차단한다', async () => {
    const broker = new FakeBrokerAdapter();
    // 평일이지만 새벽 5시 — 정규장 시간 외
    const { guard } = createGuard(broker, new Date('2026-04-24T05:00:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'BUY',
        source: 'WATCH',
      }),
    ).rejects.toMatchObject({ code: 'MARKET_TIME_CLOSED' });
  });

  it('broker 미준비 시 MARKET_SESSION_UNKNOWN 차단', async () => {
    const { guard } = createGuard(null, new Date('2026-04-24T10:00:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'SELL',
        source: 'STRATEGY',
      }),
    ).rejects.toMatchObject({ code: 'MARKET_SESSION_UNKNOWN' });
  });

  it('정규장 개장일은 허용하고 하루 결과를 캐시한다', async () => {
    const broker = new FakeBrokerAdapter({
      // 평일 10시 + isTradingDayFn 의 default 가 평일 true 라 OK.
    });
    const { guard } = createGuard(broker, new Date('2026-04-24T10:00:00+09:00'));
    const input = {
      accountId: 1,
      pdno: '452450',
      side: 'SELL' as const,
      source: 'STRATEGY' as const,
    };

    await expect(guard.assertAutoOrderAllowed(input)).resolves.toBeUndefined();
    await expect(guard.assertAutoOrderAllowed(input)).resolves.toBeUndefined();
    // 두 번째 호출은 캐시 hit — broker 1 회만 호출
    expect(broker.callCount.getTradingDayStatus).toBe(1);
  });

  it('broker.getTradingDayStatus 가 휴장일이면 자동주문을 차단한다', async () => {
    const broker = new FakeBrokerAdapter({
      isTradingDayFn: () => false, // 강제 false (예: 임시 휴장일)
    });
    const { guard } = createGuard(broker, new Date('2026-04-24T10:00:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'SELL',
        source: 'WATCH',
      }),
    ).rejects.toBeInstanceOf(AutoOrderBlockedError);
  });

  it('broker.getTradingDayStatus 가 에러 반환 시 MARKET_SESSION_UNKNOWN', async () => {
    const broker = new FakeBrokerAdapter({
      forceError: { brokerId: 'KIS', kind: 'NETWORK', msg: 'down' },
    });
    const { guard } = createGuard(broker, new Date('2026-04-24T10:00:00+09:00'));

    await expect(
      guard.assertAutoOrderAllowed({
        accountId: 1,
        pdno: '452450',
        side: 'BUY',
        source: 'STRATEGY',
      }),
    ).rejects.toMatchObject({ code: 'MARKET_SESSION_UNKNOWN' });
  });
});
