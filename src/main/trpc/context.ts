import type { AppEnv } from '@shared/contracts';
import type { Db } from '../db/client';
import type { SettingsRepo } from '../db/settings-repo';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import type { SafetyState } from '../safety/safety-state';
import type { CredentialsRepo } from '../security/credentials-repo';

export interface Context {
  db: Db;
  credentialsRepo: CredentialsRepo;
  settingsRepo: SettingsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  safety: SafetyState;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
}

export function createContextFactory(deps: Omit<Context, 'setCurrentEnv' | 'currentEnv'>): {
  create: () => Context;
  setEnv: (env: AppEnv | null) => void;
} {
  let currentEnv: AppEnv | null = null;
  const setCurrentEnv = (env: AppEnv | null): void => {
    currentEnv = env;
  };
  return {
    create: () => ({
      ...deps,
      get currentEnv() {
        return currentEnv;
      },
      setCurrentEnv,
    }),
    setEnv: setCurrentEnv,
  };
}
