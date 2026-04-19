import type { AppEnv } from '@shared/contracts';
import type { Db } from '../db/client';
import type { SettingsRepo } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import type { EventLogger } from '../logging/event-logger';
import type { FeedBus } from '../realtime/feed-bus';
import type { RealtimeService } from '../realtime/realtime-service';
import type { SafetyState } from '../safety/safety-state';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import type { LotsRepo } from '../trading/lots-repo';
import type { StockMasterRepo } from '../trading/stock-master-repo';
import type { StockMasterSyncService } from '../trading/stock-master-sync';
import type { StrategyRepo } from '../trading/strategy-repo';

export interface Context {
  db: Db;
  credentialsRepo: CredentialsRepo;
  settingsRepo: SettingsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  safety: SafetyState;
  logger: EventLogger;
  strategyRepo: StrategyRepo;
  stockMasterRepo: StockMasterRepo;
  stockMasterSync: StockMasterSyncService;
  candlesRepo: DailyCandlesRepo;
  lotsRepo: LotsRepo;
  realtime: RealtimeService | null;
  bus: FeedBus | null;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
}

export interface ContextFactoryOptions
  extends Omit<Context, 'setCurrentEnv' | 'currentEnv' | 'realtime'> {
  /** env 전환 시 realtime 재생성을 호출측에 위임. 반환값이 현재 RealtimeService. */
  realtimeFactory?: (env: AppEnv | null) => RealtimeService | null;
}

export function createContextFactory(opts: ContextFactoryOptions): {
  create: () => Context;
  setEnv: (env: AppEnv | null) => void;
  getRealtime: () => RealtimeService | null;
} {
  const { realtimeFactory, ...deps } = opts;
  let currentEnv: AppEnv | null = null;
  let realtime: RealtimeService | null = null;

  const setCurrentEnv = (env: AppEnv | null): void => {
    currentEnv = env;
    if (realtimeFactory) {
      realtime = realtimeFactory(env);
    }
  };

  return {
    create: () => ({
      ...deps,
      get currentEnv() {
        return currentEnv;
      },
      get realtime() {
        return realtime;
      },
      setCurrentEnv,
    }),
    setEnv: setCurrentEnv,
    getRealtime: () => realtime,
  };
}
