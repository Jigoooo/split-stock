import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

export const REALTIME_DEFAULTS = {
  /** KIS WS 세션 capacity 기본값 — 현행 한도(20). 60 확장 시 UI에서 변경 가능. */
  wsCapacity: 20,
  /** 사용자가 설정 가능한 capacity 범위 — 60종목 확장 시 상한 60. */
  wsCapacityMin: 1,
  wsCapacityMax: 60,
} as const;

export interface RealtimeConfig {
  wsCapacity: number;
}

export function readRealtimeConfig(repo: SettingsRepo): RealtimeConfig {
  const raw = repo.get(SETTING_KEYS.REALTIME_WS_CAPACITY);
  const n = raw !== null ? Number(raw) : REALTIME_DEFAULTS.wsCapacity;
  const wsCapacity =
    Number.isFinite(n) &&
    n >= REALTIME_DEFAULTS.wsCapacityMin &&
    n <= REALTIME_DEFAULTS.wsCapacityMax
      ? Math.floor(n)
      : REALTIME_DEFAULTS.wsCapacity;
  return { wsCapacity };
}
