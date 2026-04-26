import type { Timer } from '../brokers/core/types';

interface TimeoutEntry {
  cb: () => void;
  at: number;
  cleared: boolean;
}

interface IntervalEntry {
  cb: () => void;
  every: number;
  next: number;
  cleared: boolean;
}

/**
 * 테스트용 Timer 구현 — setTimeout / setInterval / advance 지원.
 * advance(ms) 호출 시 target 시각까지의 타이머를 시간순으로 발화.
 */
export class FakeTimer implements Timer {
  private timeouts: TimeoutEntry[] = [];
  private intervals: IntervalEntry[] = [];
  private current = 0;

  setTimeout(cb: () => void, ms: number): { clear: () => void } {
    const entry: TimeoutEntry = { cb, at: this.current + ms, cleared: false };
    this.timeouts.push(entry);
    return {
      clear: () => {
        entry.cleared = true;
      },
    };
  }

  setInterval(cb: () => void, ms: number): { clear: () => void } {
    const entry: IntervalEntry = { cb, every: ms, next: this.current + ms, cleared: false };
    this.intervals.push(entry);
    return {
      clear: () => {
        entry.cleared = true;
      },
    };
  }

  now(): number {
    return this.current;
  }

  /** 현재 시각을 직접 지정 (advance 없이 점프). */
  setNow(t: number): void {
    this.current = t;
  }

  /** target 시각까지 타이머를 시간순으로 발화. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (let i = 0; i < 10_000; i++) {
      const nextTimeout = this.timeouts
        .filter((t) => !t.cleared && t.at <= target)
        .map((t) => t.at);
      const nextInterval = this.intervals
        .filter((t) => !t.cleared && t.next <= target)
        .map((t) => t.next);
      const nextAt = [...nextTimeout, ...nextInterval].sort((a, b) => a - b)[0];
      if (nextAt === undefined) break;
      this.current = nextAt;

      const firingTimeouts = this.timeouts.filter((t) => !t.cleared && t.at === nextAt);
      for (const t of firingTimeouts) {
        t.cleared = true;
        t.cb();
      }

      const firingIntervals = this.intervals.filter((t) => !t.cleared && t.next === nextAt);
      for (const t of firingIntervals) {
        t.next = t.next + t.every;
        t.cb();
      }
    }
    this.current = target;
  }
}
