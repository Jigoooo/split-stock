import type { Timer } from '../kis/ws-client';
import type { OrderbookUpdate } from '../kis/ws-frame-parser';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from './feed-bus';

export interface OrderbookRestPollerDeps {
  /**
   * WS 단절 시 REST fallback 으로 호가 데이터를 가져오는 함수.
   * 인증 토큰 취득 + `inquireOrderbook` 호출을 캡슐화.
   * null 반환 시 해당 tick 은 건너뜀 (rate-limit / auth 미완료 등).
   */
  fetchOrderbook: (pdno: string) => Promise<OrderbookUpdate | null>;
  /** 실시간 데이터 버스 — WS 와 동일한 채널에 emit */
  bus: FeedBus;
  /**
   * 현재 사용자가 보고 있는 종목 코드를 lazy 하게 반환.
   * null 이면 대상 없음 → 해당 tick 건너뜀.
   * RealtimeService.focused Set 의 첫 번째 항목(단일 focus 정책)을 참조.
   */
  getFocusedSymbol: () => string | null;
  /** Injectable timer — 테스트에서 fake timer 주입 가능 */
  timer: Timer;
  logger: EventLogger;
  /** polling 간격 ms (기본 1000). KIS rate-limit = 1 RPS 기준. */
  intervalMs?: number;
}

/**
 * WS 단절 시 REST inquireOrderbook 1 Hz 폴링 루프.
 *
 * - `start()`: 즉시 한 번 fetch + emit → `setInterval(intervalMs)` 등록
 * - `stop()`:  interval 해제 (idempotent)
 * - `dispose()`: `stop()` 과 동일 (RealtimeService.stop() 에서 일관성 있게 호출)
 *
 * 단일 focused 종목만 폴링하므로 최대 1 RPS → KIS rate-limit 침해 없음.
 * fetchOrderbook 이 throw 해도 loop 는 종료되지 않음.
 */
export class OrderbookRestPoller {
  private readonly intervalMs: number;
  private intervalHandle: { clear(): void } | null = null;
  private running = false;

  constructor(private readonly deps: OrderbookRestPollerDeps) {
    this.intervalMs = deps.intervalMs ?? 1000;
  }

  /**
   * 폴링 시작.
   * 이미 running 중이면 no-op (중복 interval 방지).
   * - 즉시 fetch (WS→REST 전환 지연 ≤1s 요건 충족)
   * - 이후 `intervalMs` 마다 반복
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // 즉시 첫 번째 fetch (microtask — async 지연 최소화)
    void this.poll();

    // 1 Hz 반복
    this.intervalHandle = this.deps.timer.setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  /**
   * 폴링 중단. 이미 stopped 면 no-op.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.intervalHandle?.clear();
    this.intervalHandle = null;
  }

  /**
   * `stop()` 과 동일. `RealtimeService.stop()` 에서 호출.
   */
  dispose(): void {
    this.stop();
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                            */
  /* ------------------------------------------------------------------ */

  private async poll(): Promise<void> {
    const pdno = this.deps.getFocusedSymbol();
    if (!pdno) return; // focused 종목 없음 → 건너뜀

    try {
      const update = await this.deps.fetchOrderbook(pdno);
      if (update === null) return; // auth 미완료 / rate-limit 등

      // WS와 동일한 버스 채널에 emit
      this.deps.bus.emitOrderbook(update);
    } catch (err) {
      // 오류 로깅 후 루프 유지 — KIS 일시 장애 시 자동 복구 기대
      this.deps.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'orderbook_rest_poller.fetch_error',
        payload: { pdno, err: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
