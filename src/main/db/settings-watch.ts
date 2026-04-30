import { watchGlobalEnabledKey } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export function readWatchGlobalEnabled(repo: SettingsRepo, accountId: number): boolean {
  const raw = repo.get(watchGlobalEnabledKey(accountId));
  return raw !== 'false';
}
