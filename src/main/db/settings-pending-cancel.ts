import { type ReorderMode, SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export const PENDING_CANCEL_DEFAULTS = {
  enabled: true,
  timeoutMin: 10,
  maxRetries: 5 as number | null,
  reorderMode: 'NONE' as ReorderMode,
} as const;

export function readPendingCancelConfig(repo: SettingsRepo): {
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number | null;
  reorderMode: ReorderMode;
} {
  const enabledRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_ENABLED);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : PENDING_CANCEL_DEFAULTS.enabled;

  const minRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN);
  const minutes = minRaw !== null ? Number(minRaw) : PENDING_CANCEL_DEFAULTS.timeoutMin;
  const clampedMin =
    Number.isFinite(minutes) && minutes >= 1 && minutes <= 60
      ? minutes
      : PENDING_CANCEL_DEFAULTS.timeoutMin;

  const retriesRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES);
  let maxRetries: number | null;
  if (retriesRaw === null) {
    maxRetries = PENDING_CANCEL_DEFAULTS.maxRetries;
  } else if (retriesRaw === 'unlimited') {
    maxRetries = null;
  } else {
    const n = Number(retriesRaw);
    maxRetries = Number.isFinite(n) && n >= 1 && n <= 30 ? n : PENDING_CANCEL_DEFAULTS.maxRetries;
  }

  const reorderRaw = repo.get(SETTING_KEYS.PENDING_CANCEL_REORDER_MODE);
  const validReorderModes: ReorderMode[] = ['NONE', 'MARKET', 'LIMIT_AT_LAST_PRICE'];
  const reorderMode: ReorderMode =
    reorderRaw !== null && validReorderModes.includes(reorderRaw as ReorderMode)
      ? (reorderRaw as ReorderMode)
      : PENDING_CANCEL_DEFAULTS.reorderMode;

  return { enabled, timeoutMs: clampedMin * 60_000, maxRetries, reorderMode };
}
