/**
 * DataFreshnessTracker 단위 테스트 (D3 chart_swr_cache)
 *
 * - isStale: lastDataMs 이후 staleThresholdMs 경과 시 true
 * - showReconnectButton: lastDataMs 이후 reconnectButtonAfterMs(=30s) 경과 시만 true
 * - recordDataReceived(): 호출 즉시 isStale/showReconnectButton 해제
 * - getNow injectable 로 타이머 제어 (fake clock)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFreshnessTracker } from './data-freshness-tracker';

describe('DataFreshnessTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('초기 상태: 데이터 미수신 — isStale=false, showReconnectButton=false', () => {
    const tracker = new DataFreshnessTracker({ staleThresholdMs: 10_000 });
    const state = tracker.getState();
    expect(state.isStale).toBe(false);
    expect(state.showReconnectButton).toBe(false);
  });

  it('staleThresholdMs 경과 후 isStale=true', () => {
    let now = 1_000_000;
    const tracker = new DataFreshnessTracker({
      staleThresholdMs: 10_000,
      reconnectButtonAfterMs: 30_000,
      getNow: () => now,
    });
    tracker.recordDataReceived();
    // 9.9s → 아직 stale 아님
    now += 9_900;
    expect(tracker.getState().isStale).toBe(false);
    // 10.1s → stale
    now += 200;
    expect(tracker.getState().isStale).toBe(true);
    expect(tracker.getState().showReconnectButton).toBe(false); // 30s 미경과
  });

  it('reconnectButtonAfterMs(30s) 경과 후 showReconnectButton=true', () => {
    let now = 1_000_000;
    const tracker = new DataFreshnessTracker({
      staleThresholdMs: 10_000,
      reconnectButtonAfterMs: 30_000,
      getNow: () => now,
    });
    tracker.recordDataReceived();
    now += 29_900;
    expect(tracker.getState().showReconnectButton).toBe(false);
    now += 200;
    expect(tracker.getState().showReconnectButton).toBe(true);
    expect(tracker.getState().isStale).toBe(true);
  });

  it('recordDataReceived() 호출 시 isStale + showReconnectButton 즉시 해제', () => {
    let now = 1_000_000;
    const tracker = new DataFreshnessTracker({
      staleThresholdMs: 10_000,
      reconnectButtonAfterMs: 30_000,
      getNow: () => now,
    });
    tracker.recordDataReceived();
    now += 35_000; // 버튼까지 노출
    expect(tracker.getState().showReconnectButton).toBe(true);

    tracker.recordDataReceived(); // 데이터 갱신
    expect(tracker.getState().isStale).toBe(false);
    expect(tracker.getState().showReconnectButton).toBe(false);
  });

  it('recordDataReceived 이전에는 isStale=false (데이터 없음 → stale 아님)', () => {
    let now = 1_000_000;
    const tracker = new DataFreshnessTracker({
      staleThresholdMs: 5_000,
      reconnectButtonAfterMs: 30_000,
      getNow: () => now,
    });
    // 데이터 수신 전 시간 경과 → stale 아님 (아직 시작도 안 한 상태)
    now += 60_000;
    expect(tracker.getState().isStale).toBe(false);
    expect(tracker.getState().showReconnectButton).toBe(false);
  });
});
