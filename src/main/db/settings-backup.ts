import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export const BACKUP_AUTO_DEFAULTS = {
  enabled: true,
  retentionDays: 10,
} as const;

export function readBackupAutoConfig(repo: SettingsRepo): {
  enabled: boolean;
  retentionDays: number;
} {
  const enabledRaw = repo.get(SETTING_KEYS.BACKUP_AUTO_ENABLED);
  const enabled = enabledRaw !== null ? enabledRaw === 'true' : BACKUP_AUTO_DEFAULTS.enabled;

  const daysRaw = repo.get(SETTING_KEYS.BACKUP_AUTO_RETENTION_DAYS);
  const days = daysRaw !== null ? Number(daysRaw) : BACKUP_AUTO_DEFAULTS.retentionDays;
  const retentionDays =
    Number.isFinite(days) && days >= 1 && days <= 365
      ? Math.floor(days)
      : BACKUP_AUTO_DEFAULTS.retentionDays;

  return { enabled, retentionDays };
}
