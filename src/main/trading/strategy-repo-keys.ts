const ACTIVE_PREFIX = 'strategy.active';
const PRESET_PREFIX = 'strategy.preset';

export const LEGACY_ACTIVE_PREFIX = 'strategy.active';
export const LEGACY_PRESET_PREFIX = 'strategy.preset.';

export function activeKey(accountId: number, pdno: string | null): string {
  return pdno ? `${ACTIVE_PREFIX}.${accountId}.${pdno}` : `${ACTIVE_PREFIX}.${accountId}`;
}

export function activePrefixForAccount(accountId: number): string {
  return `${ACTIVE_PREFIX}.${accountId}.`;
}

export function isStrategyRepoProfileKey(key: string): boolean {
  return key.startsWith(`${ACTIVE_PREFIX}.`) || key.startsWith(`${PRESET_PREFIX}.`);
}

export function presetKey(accountId: number, name: string): string {
  return `${PRESET_PREFIX}.${accountId}.${name}`;
}

export function presetPrefixForAccount(accountId: number): string {
  return `${PRESET_PREFIX}.${accountId}.`;
}
