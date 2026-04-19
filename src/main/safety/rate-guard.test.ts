import { describe, expect, it } from 'vitest';
import type { EventLogger } from '../logging/event-logger';
import { createRateGuard, type RateGuardRepo, type RateGuardSettings } from './rate-guard';
import { createSafetyState, SafetyStateRegistry } from './safety-state';

function noopLogger(): EventLogger & { entries: Array<{ message: string; payload?: unknown }> } {
  const entries: Array<{ message: string; payload?: unknown }> = [];
  return {
    entries,
    log: (e) => {
      entries.push({ message: e.message, payload: e.payload });
    },
  };
}

function makeRepo(settings: RateGuardSettings): RateGuardRepo {
  let current = { ...settings };
  return {
    getSettings: () => ({ ...current }),
    updateSettings: (_accountId, enabled, windowSeconds, maxCount) => {
      current = { enabled, windowSeconds, maxCount };
    },
  };
}

describe('RateGuard — 연속매수 방지', () => {
  it('rate-guard 비활성 시 checkAndPossiblyDisableAuto → switchedToManual=false', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    const safety = registry.get(1);
    safety.setMaster(true);

    const guard = createRateGuard({
      repo: makeRepo({ enabled: false, windowSeconds: 10, maxCount: 3 }),
      safetyRegistry: registry,
      logger,
    });

    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1001);
    guard.recordBuy(1, '005930', 1002);
    guard.recordBuy(1, '005930', 1003);
    guard.recordBuy(1, '005930', 1004); // N+1

    const result = guard.checkAndPossiblyDisableAuto(1);
    expect(result.switchedToManual).toBe(false);
    expect(safety.getSnapshot().master).toBe(true); // 그대로 ON
  });

  it('N회까지는 자동매매 유지', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    registry.get(1).setMaster(true);

    const guard = createRateGuard({
      repo: makeRepo({ enabled: true, windowSeconds: 60, maxCount: 3 }),
      safetyRegistry: registry,
      logger,
      now: () => 1000,
    });

    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000); // 정확히 maxCount=3

    const result = guard.checkAndPossiblyDisableAuto(1);
    expect(result.switchedToManual).toBe(false);
    expect(registry.get(1).getSnapshot().master).toBe(true);
  });

  it('N+1번째 매수 → 자동매매 OFF + 이벤트 로그', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    registry.get(1).setMaster(true);

    const guard = createRateGuard({
      repo: makeRepo({ enabled: true, windowSeconds: 60, maxCount: 3 }),
      safetyRegistry: registry,
      logger,
      now: () => 1000,
    });

    // 4회 기록 (maxCount=3 이므로 N+1)
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);

    const result = guard.checkAndPossiblyDisableAuto(1);
    expect(result.switchedToManual).toBe(true);
    expect(registry.get(1).getSnapshot().master).toBe(false); // 자동매매 OFF
    const logEntry = logger.entries.find((e) => e.message === 'rate_guard.auto_disabled');
    expect(logEntry).toBeDefined();
    expect(logEntry?.payload).toMatchObject({ accountId: 1, pdno: '005930', count: 4 });
  });

  it('윈도우 밖 타임스탬프는 카운트 제외', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    registry.get(1).setMaster(true);

    const windowSeconds = 10;
    const currentTime = 20_000; // 20초

    const guard = createRateGuard({
      repo: makeRepo({ enabled: true, windowSeconds, maxCount: 2 }),
      safetyRegistry: registry,
      logger,
      now: () => currentTime,
    });

    // 오래된 매수 3회 (now - 15초 전 → 윈도우 밖)
    guard.recordBuy(1, '005930', currentTime - 15_000);
    guard.recordBuy(1, '005930', currentTime - 15_000);
    guard.recordBuy(1, '005930', currentTime - 15_000);

    // 최신 매수 2회 (윈도우 안)
    guard.recordBuy(1, '005930', currentTime - 5_000);
    guard.recordBuy(1, '005930', currentTime - 5_000);

    const result = guard.checkAndPossiblyDisableAuto(1);
    // 최신 2회는 maxCount=2와 같으므로 N+1 아님 → 유지
    expect(result.switchedToManual).toBe(false);
    expect(registry.get(1).getSnapshot().master).toBe(true);
  });

  it('종목별 카운터 분리 — A 종목 과다매수가 B 종목 영향 없음', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    registry.get(1).setMaster(true);

    const guard = createRateGuard({
      repo: makeRepo({ enabled: true, windowSeconds: 60, maxCount: 2 }),
      safetyRegistry: registry,
      logger,
      now: () => 1000,
    });

    // 005930 → 3회 (N+1)
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);

    const result = guard.checkAndPossiblyDisableAuto(1);
    expect(result.switchedToManual).toBe(true);

    // 다른 종목 000660 은 카운터 0이므로 이미 master=false 지만
    // 이 테스트의 핵심은 "카운터가 종목별로 분리되어 있다"는 것.
    // 재확인: master 이미 꺼진 상태에서 000660 단독으로는 트리거 안 됨
    registry.get(1).setMaster(true); // 강제 복원
    guard.recordBuy(1, '000660', 1000);
    const result2 = guard.checkAndPossiblyDisableAuto(1);
    // 000660 은 1회 → maxCount=2 미초과 → 유지
    expect(result2.switchedToManual).toBe(false);
  });

  it('per-account 격리 — 계좌 A의 연속매수가 계좌 B에 영향 없음', () => {
    const logger = noopLogger();
    const registry = new SafetyStateRegistry({ logger });
    registry.get(1).setMaster(true);
    registry.get(2).setMaster(true);

    const guard = createRateGuard({
      repo: makeRepo({ enabled: true, windowSeconds: 60, maxCount: 2 }),
      safetyRegistry: registry,
      logger,
      now: () => 1000,
    });

    // 계좌 1에서만 N+1 발생
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    guard.recordBuy(1, '005930', 1000);
    const r1 = guard.checkAndPossiblyDisableAuto(1);
    expect(r1.switchedToManual).toBe(true);
    expect(registry.get(1).getSnapshot().master).toBe(false);

    // 계좌 2는 영향 없음
    const r2 = guard.checkAndPossiblyDisableAuto(2);
    expect(r2.switchedToManual).toBe(false);
    expect(registry.get(2).getSnapshot().master).toBe(true);
  });
});
