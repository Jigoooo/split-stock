import {
  migrateLegacyStrategyProfile,
  normalizeStrategyProfile,
  type StrategyProfile,
  StrategyProfileSchema,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import type { StrategyRepoError } from './strategy-repo';

export function normalizeStrategyProfileForSave(
  profile: StrategyProfile,
  fallbackMessage: string,
): Result<StrategyProfile, StrategyRepoError> {
  const normalized = normalizeStrategyProfile(profile);
  if (normalized) return ok(normalized);

  const parsed = StrategyProfileSchema.safeParse(profile);
  return err({
    kind: 'VALIDATION',
    msg: parsed.success ? fallbackMessage : parsed.error.message,
  });
}

export function readStrategyProfile(
  settings: SettingsRepo,
  key: string,
): Result<StrategyProfile | null, StrategyRepoError> {
  const raw = settings.get(key);
  if (raw === null) return ok(null);
  try {
    const parsedRaw = JSON.parse(raw);
    const normalized = migrateLegacyStrategyProfile(parsedRaw);
    if (!normalized) {
      const next = StrategyProfileSchema.safeParse(parsedRaw);
      return err({
        kind: 'PARSE_FAILED',
        cause: next.success ? 'strategy profile normalize failed' : next.error.message,
      });
    }
    return ok(normalized);
  } catch (cause) {
    return err({ kind: 'PARSE_FAILED', cause });
  }
}
