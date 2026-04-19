import { EventEmitter } from 'node:events';
import type { KisError } from '@shared/contracts';
import type { Result } from 'neverthrow';
import type { Timer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';

/**
 * 회전 폴링 큐 — 등록된 종목 전체를 Timer 기반 고정 간격으로 순회.
 *
 * 배경(W0-4): KIS WS 실시간 시세는 계좌당 20종목 한도가 있어 종목 수 무제한 요건과 충돌.
 * 대신 KIS REST(`inquirePrice`, FHKST01010100)는 15rps 한도 안에서 사용 가능.
 * N종목을 ⌈N/15⌉초 주기로 순회 폴링하면 한도 안에서 모든 종목 가격을 갱신할 수 있다.
 *
 * 레이트 리밋 설계:
 * - 종목 간 간격: minTimeMs = ⌊1000/ratePerSec⌋ ms (기본 67ms @ 15rps)
 * - HTTP 레이어(KisHttpClient)의 Bottleneck reservoir=15/s 가 하드캡을 보장.
 * - 본 모듈은 Timer 인터페이스로 간격을 제어 → FakeTimer 주입으로 테스트 가능.
 *
 * 책임 분리:
 * - 본 모듈: REST 회전 폴링이 메인 가격 소스. WS는 건드리지 않음.
 * - W1-7에서 KIS WS는 체결통보(H0STCNI0/9) + 잔고 전용으로 분리 예정.
 *
 * 불변식:
 * - 같은 사이클 안에서 같은 종목은 한 번만 폴링.
 * - 한 사이클 = 등록된 모든 종목을 한 번 순회. 사이클 길이 ≈ N * minTimeMs ms.
 * - 5회 연속 실패한 종목은 다음 사이클부터 cooldownCycles 만큼 skip.
 */

export interface QuoteSnapshot {
  pdno: string;
  price: number;
  /** epoch ms — emit 시점. */
  ts: number;
}

export interface PricePoller {
  fetch(pdno: string): Promise<Result<{ price: number }, KisError>>;
}

export interface QuoteFeedEvents {
  quote: (snapshot: QuoteSnapshot) => void;
  /** maxConsecutiveFailures 회 연속 실패 후 쿨다운 진입. */
  cooldown: (info: { pdno: string; failures: number; error: KisError }) => void;
}

export interface QuoteFeedOptions {
  timer: Timer;
  poller: PricePoller;
  logger: EventLogger;
  /** KIS REST 글로벌 한도 (기본 15rps). minTimeMs = ⌊1000/ratePerSec⌋. */
  ratePerSec?: number;
  /** 연속 실패 임계값. 도달 시 cooldownCycles 만큼 skip (기본 5). */
  maxConsecutiveFailures?: number;
  /** 쿨다운 시 skip 사이클 수 (기본 1). */
  cooldownCycles?: number;
}

export interface QuoteFeed {
  subscribe(pdno: string): void;
  unsubscribe(pdno: string): void;
  on<E extends keyof QuoteFeedEvents>(event: E, handler: QuoteFeedEvents[E]): void;
  off<E extends keyof QuoteFeedEvents>(event: E, handler: QuoteFeedEvents[E]): void;
  getActiveSymbols(): string[];
  dispose(): void;
}

interface SymbolState {
  consecutiveFailures: number;
  /** 0이면 즉시 폴링, >0이면 다음 사이클에 -1 하면서 skip. */
  skipCyclesRemaining: number;
}

/**
 * 회전 폴링 큐 구현.
 *
 * 동작:
 * 1. `subscribe(pdno)` 시 종목 추가. 사이클이 없으면 즉시 시작.
 * 2. 매 tick: cycleQueue 에서 종목 하나 꺼내 fetch 호출 → minTimeMs 후 다음 tick.
 * 3. 큐 소진 시 다음 사이클 시작 (symbols 스냅샷 재취득, 쿨다운 tick-down).
 * 4. fetch 성공: emit `quote`, failure counter 리셋.
 *    실패: counter +1, 임계 도달 시 emit `cooldown` + skipCyclesRemaining 설정.
 *
 * 종료: `dispose()` 호출 시 pending 타이머 해제, 이후 이벤트 emit 없음.
 */
export class RotatingQuoteFeed implements QuoteFeed {
  private readonly emitter = new EventEmitter();
  private readonly symbols = new Map<string, SymbolState>();
  private readonly minTimeMs: number;
  private readonly maxFailures: number;
  private readonly cooldownCycles: number;

  private disposed = false;
  private cycleQueue: string[] = [];
  private tickHandle: { clear: () => void } | null = null;
  /** 디버깅/테스트용 — 누적 사이클 수. */
  private _cyclesStarted = 0;

  constructor(private readonly opts: QuoteFeedOptions) {
    const rps = opts.ratePerSec ?? 15;
    if (rps <= 0) throw new Error('ratePerSec must be > 0');
    this.minTimeMs = Math.floor(1000 / rps);
    this.maxFailures = opts.maxConsecutiveFailures ?? 5;
    this.cooldownCycles = opts.cooldownCycles ?? 1;
  }

  subscribe(pdno: string): void {
    if (this.disposed) return;
    if (this.symbols.has(pdno)) return;
    this.symbols.set(pdno, { consecutiveFailures: 0, skipCyclesRemaining: 0 });
    if (!this.tickHandle) {
      this.startCycle();
    }
  }

  unsubscribe(pdno: string): void {
    this.symbols.delete(pdno);
    this.cycleQueue = this.cycleQueue.filter((p) => p !== pdno);
  }

  on<E extends keyof QuoteFeedEvents>(event: E, handler: QuoteFeedEvents[E]): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<E extends keyof QuoteFeedEvents>(event: E, handler: QuoteFeedEvents[E]): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  getActiveSymbols(): string[] {
    return Array.from(this.symbols.keys());
  }

  getCyclesStarted(): number {
    return this._cyclesStarted;
  }

  dispose(): void {
    this.disposed = true;
    this.tickHandle?.clear();
    this.tickHandle = null;
    this.symbols.clear();
    this.cycleQueue = [];
  }

  /** 새 사이클 — 현재 symbols 스냅샷을 큐로 복사하고 첫 tick 예약. */
  private startCycle(): void {
    if (this.disposed || this.symbols.size === 0) return;
    this._cyclesStarted += 1;

    const queue: string[] = [];
    for (const [pdno, state] of this.symbols.entries()) {
      if (state.skipCyclesRemaining > 0) {
        state.skipCyclesRemaining -= 1;
      } else {
        queue.push(pdno);
      }
    }
    this.cycleQueue = queue;
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;

    this.tickHandle = this.opts.timer.setTimeout(() => {
      this.tickHandle = null;

      if (this.cycleQueue.length === 0) {
        // 사이클 종료 → 다음 사이클 시작
        this.startCycle();
        return;
      }

      const pdno = this.cycleQueue.shift();
      if (!pdno) {
        this.startCycle();
        return;
      }

      // unsubscribe 됐으면 건너뜀
      if (!this.symbols.has(pdno)) {
        this.scheduleNextTick();
        return;
      }

      // fetch는 비동기로 띄우고, 타이머는 바로 다음 tick 예약
      void this.pollOne(pdno);
      this.scheduleNextTick();
    }, this.minTimeMs);
  }

  private async pollOne(pdno: string): Promise<void> {
    if (this.disposed || !this.symbols.has(pdno)) return;
    const state = this.symbols.get(pdno);
    if (!state) return;

    const result = await this.opts.poller.fetch(pdno);
    if (this.disposed) return;

    if (result.isErr()) {
      state.consecutiveFailures += 1;
      this.opts.logger.log({
        level: 'WARN',
        category: 'WS',
        message: 'rotating-quote-feed.fetch_failed',
        payload: { pdno, error: result.error.kind, failures: state.consecutiveFailures },
      });
      if (state.consecutiveFailures >= this.maxFailures) {
        state.skipCyclesRemaining = this.cooldownCycles;
        state.consecutiveFailures = 0;
        this.opts.logger.log({
          level: 'WARN',
          category: 'WS',
          message: 'rotating-quote-feed.cooldown',
          payload: { pdno, skipCycles: this.cooldownCycles },
        });
        this.emitter.emit('cooldown', {
          pdno,
          failures: this.maxFailures,
          error: result.error,
        });
      }
      return;
    }

    state.consecutiveFailures = 0;
    this.emitter.emit('quote', {
      pdno,
      price: result.value.price,
      ts: this.opts.timer.now(),
    } satisfies QuoteSnapshot);
  }
}

/**
 * 기존 `TieredQuoteFeed` 식별자 alias — 하위 호환용(production caller 없음, alias만 보존).
 * W0-4 재설계로 회전 폴링 큐(`RotatingQuoteFeed`)로 교체됨.
 * 신규 호출자는 `RotatingQuoteFeed` 직접 사용.
 *
 * @deprecated W0-4 이후 이 alias는 제거 예정. `RotatingQuoteFeed` 사용.
 */
export const TieredQuoteFeed = RotatingQuoteFeed;
