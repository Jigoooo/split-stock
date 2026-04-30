import { safetyMasterKey } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

/** 영속화된 안전 스위치 master 값 — 미저장 시 기본 false (차단). */
export function readSafetyMaster(repo: SettingsRepo, accountId: number): boolean {
  const raw = repo.get(safetyMasterKey(accountId));
  return raw === 'true';
}

/** 안전 스위치 master 변경 시 settings 영속화. */
export function writeSafetyMaster(repo: SettingsRepo, accountId: number, on: boolean): void {
  repo.set(safetyMasterKey(accountId), on ? 'true' : 'false');
}
