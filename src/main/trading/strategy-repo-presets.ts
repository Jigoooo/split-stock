import { migrateLegacyStrategyProfile, type StrategyProfile } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import type { StrategyRepoError } from './strategy-repo';
import { presetKey, presetPrefixForAccount } from './strategy-repo-keys';
import { normalizeStrategyProfileForSave } from './strategy-repo-read';

export function listStrategyPresets(
  settings: SettingsRepo,
  accountId: number,
): Array<{ name: string; profile: StrategyProfile }> {
  const prefix = presetPrefixForAccount(accountId);
  const results: Array<{ name: string; profile: StrategyProfile }> = [];
  for (const row of settings.list()) {
    if (!row.key.startsWith(prefix)) continue;
    const name = row.key.slice(prefix.length);
    try {
      const profile = migrateLegacyStrategyProfile(JSON.parse(row.value));
      if (profile) results.push({ name, profile });
    } catch {
      // Malformed presets are ignored on list, matching the legacy repository behavior.
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function saveStrategyPreset(
  settings: SettingsRepo,
  logger: EventLogger,
  accountId: number,
  name: string,
  profile: StrategyProfile,
): Result<void, StrategyRepoError> {
  const normalized = normalizeStrategyProfileForSave(profile, 'strategy preset normalize failed');
  if (normalized.isErr()) return err(normalized.error);
  if (name.length === 0 || name.length > 50) {
    return err({ kind: 'VALIDATION', msg: '프리셋 이름은 1~50자' });
  }
  settings.set(presetKey(accountId, name), JSON.stringify(normalized.value));
  logger.log({
    level: 'INFO',
    category: 'FSM',
    message: 'strategy.preset.saved',
    payload: { accountId, name, profile: normalized.value },
  });
  return ok(undefined);
}

export function deleteStrategyPreset(
  settings: SettingsRepo,
  logger: EventLogger,
  accountId: number,
  name: string,
): void {
  settings.delete(presetKey(accountId, name));
  logger.log({
    level: 'INFO',
    category: 'FSM',
    message: 'strategy.preset.deleted',
    payload: { accountId, name },
  });
}
