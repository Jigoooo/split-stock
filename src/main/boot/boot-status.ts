export type BootPhase =
  | 'initializing'
  | 'shell-ready'
  | 'runtime-starting'
  | 'runtime-ready'
  | 'degraded';

export interface BootFeatureFlags {
  tradingRuntimeReady: boolean;
  watchReady: boolean;
  orderReady: boolean;
  realtimeReady: boolean;
  aiReady: boolean;
  calendarReady: boolean;
  backupReady: boolean;
}

export interface BootStatusSnapshot {
  phase: BootPhase;
  flags: BootFeatureFlags;
  updatedAt: string;
  message: string | null;
}

const EMPTY_FLAGS: BootFeatureFlags = {
  tradingRuntimeReady: false,
  watchReady: false,
  orderReady: false,
  realtimeReady: false,
  aiReady: false,
  calendarReady: false,
  backupReady: false,
};

export class BootStatusService {
  private phase: BootPhase = 'initializing';
  private flags: BootFeatureFlags = { ...EMPTY_FLAGS };
  private updatedAt = new Date().toISOString();
  private message: string | null = null;

  getSnapshot(): BootStatusSnapshot {
    return {
      phase: this.phase,
      flags: { ...this.flags },
      updatedAt: this.updatedAt,
      message: this.message,
    };
  }

  setPhase(phase: BootPhase, message: string | null = null): void {
    this.phase = phase;
    this.message = message;
    this.updatedAt = new Date().toISOString();
  }

  setFlags(flags: Partial<BootFeatureFlags>): void {
    this.flags = { ...this.flags, ...flags };
    this.updatedAt = new Date().toISOString();
  }

  markShellReady(message: string | null = null): void {
    if (this.phase === 'runtime-ready' || this.phase === 'degraded') return;
    this.setPhase('shell-ready', message);
  }

  markRuntimeStarting(message: string | null = null): void {
    this.setPhase('runtime-starting', message);
  }

  markRuntimeReady(message: string | null = null): void {
    this.flags = {
      tradingRuntimeReady: true,
      watchReady: true,
      orderReady: true,
      realtimeReady: true,
      aiReady: true,
      calendarReady: true,
      backupReady: true,
    };
    this.setPhase('runtime-ready', message);
  }

  markDegraded(message: string): void {
    this.setPhase('degraded', message);
  }

  isRuntimeReady(): boolean {
    return this.phase === 'runtime-ready';
  }
}
