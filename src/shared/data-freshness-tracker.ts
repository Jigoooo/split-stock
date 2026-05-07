/**
 * 데이터 신선도 추적기 (D3 chart_swr_cache).
 *
 * 마지막 데이터 수신 시각을 기록하고, 경과 시간에 따라
 * isStale / showReconnectButton 상태를 계산한다.
 *
 * 설계 원칙:
 * - 데이터 미수신(start 전) 상태는 stale 아님 — UI 에서 로딩 스피너가 별도 처리.
 * - staleThresholdMs 경과 시 isStale=true (UI 에서 "오래된 데이터" 표시).
 * - reconnectButtonAfterMs 경과 시 showReconnectButton=true (자동 복구 30s 실패).
 * - recordDataReceived() 호출 시 두 플래그 즉시 해제 (자동 복구 성공).
 *
 * getNow 는 테스트에서 주입 가능 — 실환경에서는 Date.now().
 *
 * @shared 패키지에 위치 — main 프로세스와 renderer 모두에서 임포트 가능.
 */

export interface DataFreshnessTrackerOptions {
  /** 이 시간 이상 데이터가 없으면 isStale=true. 기본 10s. */
  staleThresholdMs?: number;
  /** 이 시간 이상 데이터가 없으면 showReconnectButton=true. 기본 30s. */
  reconnectButtonAfterMs?: number;
  /** 현재 시각 getter — 테스트에서 fake clock 주입용. */
  getNow?: () => number;
}

export interface DataFreshnessState {
  /** staleThresholdMs 이상 데이터 없음 → stale 데이터 인디케이터 표시. */
  isStale: boolean;
  /** reconnectButtonAfterMs 이상 데이터 없음 → 재연결 버튼 노출. */
  showReconnectButton: boolean;
}

export class DataFreshnessTracker {
  private readonly staleThresholdMs: number;
  private readonly reconnectButtonAfterMs: number;
  private readonly getNow: () => number;
  /** null = 데이터 아직 수신 안 됨 (start 전). */
  private lastDataMs: number | null = null;

  constructor(opts: DataFreshnessTrackerOptions = {}) {
    this.staleThresholdMs = opts.staleThresholdMs ?? 10_000;
    this.reconnectButtonAfterMs = opts.reconnectButtonAfterMs ?? 30_000;
    this.getNow = opts.getNow ?? (() => Date.now());
  }

  /**
   * 새 데이터 도착 시 호출. isStale + showReconnectButton 즉시 해제.
   */
  recordDataReceived(): void {
    this.lastDataMs = this.getNow();
  }

  /**
   * 현재 신선도 상태 조회.
   * lastDataMs=null(미수신) 이면 false/false 반환 — 로딩 중 상태.
   */
  getState(): DataFreshnessState {
    if (this.lastDataMs === null) {
      return { isStale: false, showReconnectButton: false };
    }
    const elapsed = this.getNow() - this.lastDataMs;
    return {
      isStale: elapsed >= this.staleThresholdMs,
      showReconnectButton: elapsed >= this.reconnectButtonAfterMs,
    };
  }
}
