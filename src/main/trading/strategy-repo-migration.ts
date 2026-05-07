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

/**
 * "기본값 그대로인데 자동매매 ON" 으로 설정된 strategy 를 강제로 OFF 처리하는 안전 정책의
 * 1회 실행 플래그. 한 번 실행된 후 (= 이 키가 settings 에 저장된 후) 부터는 사용자가
 * "default-shape + 자동매매 ON" 을 명시적으로 선택해도 다시 OFF 로 reset 하지 않는다.
 *
 * 사유: 이 정책은 legacy 사용자가 의도치 않게 default 자동매매를 켠 채 첫 부팅하는 회귀를
 * 1회 차단하는 목적이었으나, 매 부팅마다 실행되어 "사용자가 ON 으로 토글한 게 재시작 시
 * OFF 로 돌아가는" 회귀를 유발했다. 한 번 정착되면 이후는 사용자 명시 선택 우선.
 */
const SAFETY_AUTO_DISABLE_MIGRATED_KEY = 'strategy.safety.auto_disable.v1.migrated_at';

export function upgradeStoredStrategyProfiles(
  settings: SettingsRepo,
  logger: EventLogger,
): { upgraded: number; recovered: number; autoDisabled: number } {
  let upgraded = 0;
  let recovered = 0;
  let autoDisabled = 0;
  const shouldApplyAutoDisable = settings.get(SAFETY_AUTO_DISABLE_MIGRATED_KEY) === null;

  for (const row of settings.list()) {
    if (!isStrategyRepoProfileKey(row.key)) continue;

    const recovery = parseStoredProfile(row.value);
    let nextProfile = recovery.profile;
    if (recovery.recoveredWithDefault) recovered += 1;

    if (
      shouldApplyAutoDisable &&
      row.key.startsWith('strategy.active.') &&
      isUnsafeDefaultAutoProfile(nextProfile)
    ) {
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
  // 1회 실행 후 플래그 set — 이후 부팅에서는 default-shape + 자동매매 ON 을 강제 OFF 하지 않음.
  // 사용자 ON 토글이 재시작 시 OFF 로 reset 되던 회귀를 차단.
  if (shouldApplyAutoDisable) {
    settings.set(SAFETY_AUTO_DISABLE_MIGRATED_KEY, new Date().toISOString());
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
