import {
  DEFAULT_STRATEGY_PROFILE,
  migrateLegacyStrategyProfile,
  type StrategyProfile,
} from '@shared/contracts';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import {
  activeKey,
  isStrategyRepoProfileKey,
  LEGACY_ACTIVE_PREFIX,
  LEGACY_PRESET_PREFIX,
  presetKey,
} from './strategy-repo-keys';
import { isUnsafeDefaultAutoProfile } from './strategy-repo-policy';

export function migrateLegacyStrategyKeys(
  settings: SettingsRepo,
  logger: EventLogger,
  defaultAccountId: number,
): { migrated: number } {
  let migrated = 0;
  for (const row of settings.list()) {
    const key = row.key;
    if (key === LEGACY_ACTIVE_PREFIX) {
      const newKey = activeKey(defaultAccountId, null);
      if (settings.get(newKey) === null) {
        settings.set(newKey, row.value);
        settings.delete(key);
        migrated++;
      }
      continue;
    }

    if (key.startsWith(`${LEGACY_ACTIVE_PREFIX}.`)) {
      const tail = key.slice(LEGACY_ACTIVE_PREFIX.length + 1);
      if (tail.includes('.')) continue;
      if (/^\d{6}$/.test(tail)) {
        const newKey = activeKey(defaultAccountId, tail);
        if (settings.get(newKey) === null) {
          settings.set(newKey, row.value);
          settings.delete(key);
          migrated++;
        }
      }
      continue;
    }

    if (key.startsWith(LEGACY_PRESET_PREFIX)) {
      const tail = key.slice(LEGACY_PRESET_PREFIX.length);
      const firstSeg = tail.split('.')[0];
      if (firstSeg !== undefined && /^\d+$/.test(firstSeg) && tail.includes('.')) {
        continue;
      }
      const newKey = presetKey(defaultAccountId, tail);
      if (settings.get(newKey) === null) {
        settings.set(newKey, row.value);
        settings.delete(key);
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.legacy_keys.migrated',
      payload: { accountId: defaultAccountId, count: migrated },
    });
  }
  return { migrated };
}

export function upgradeStoredStrategyProfiles(
  settings: SettingsRepo,
  logger: EventLogger,
): { upgraded: number; recovered: number; autoDisabled: number } {
  let upgraded = 0;
  let recovered = 0;
  let autoDisabled = 0;

  for (const row of settings.list()) {
    if (!isStrategyRepoProfileKey(row.key)) continue;

    const recovery = parseStoredProfile(row.value);
    let nextProfile = recovery.profile;
    if (recovery.recoveredWithDefault) recovered += 1;

    if (row.key.startsWith('strategy.active.') && isUnsafeDefaultAutoProfile(nextProfile)) {
      nextProfile = {
        ...nextProfile,
        autoBuyEnabled: false,
        autoSellEnabled: false,
      };
      autoDisabled += 1;
    }

    const normalized = JSON.stringify(nextProfile);
    if (normalized === row.value) continue;

    settings.set(row.key, normalized);
    if (recovery.recoveredWithDefault) {
      logger.log({
        level: 'ERROR',
        category: 'FSM',
        message: 'strategy.migration.recovered_with_default',
        payload: { key: row.key },
      });
    } else {
      upgraded += 1;
    }
  }

  if (upgraded > 0 || recovered > 0) {
    logger.log({
      level: recovered > 0 ? 'WARN' : 'INFO',
      category: 'FSM',
      message: 'strategy.migration.completed',
      payload: { upgraded, recovered, autoDisabled },
    });
  }
  if (autoDisabled > 0) {
    logger.log({
      level: 'WARN',
      category: 'FSM',
      message: 'strategy.default_auto.disabled',
      payload: { count: autoDisabled },
    });
  }
  return { upgraded, recovered, autoDisabled };
}

function parseStoredProfile(value: string): {
  profile: StrategyProfile;
  recoveredWithDefault: boolean;
} {
  try {
    const migrated = migrateLegacyStrategyProfile(JSON.parse(value));
    if (migrated) return { profile: migrated, recoveredWithDefault: false };
  } catch {
    // fall through to default recovery
  }
  return { profile: DEFAULT_STRATEGY_PROFILE, recoveredWithDefault: true };
}
