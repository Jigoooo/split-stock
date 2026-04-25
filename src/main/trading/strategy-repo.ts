import {
  DEFAULT_STRATEGY_PROFILE,
  migrateLegacyStrategyProfile,
  normalizeStrategyProfile,
  type StrategyProfile,
  StrategyProfileSchema,
} from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';

export type StrategyRepoError =
  | { kind: 'VALIDATION'; msg: string }
  | { kind: 'PARSE_FAILED'; cause: unknown };

export type StrategyEffectiveSource = 'symbol' | 'global' | 'default';

const ACTIVE_PREFIX = 'strategy.active';
const PRESET_PREFIX = 'strategy.preset';
const LEGACY_ACTIVE_PREFIX = 'strategy.active'; // 단일 계좌 시절 키 prefix
const LEGACY_PRESET_PREFIX = 'strategy.preset.'; // 단일 계좌 시절 키 prefix

function activeKey(accountId: number, pdno: string | null): string {
  return pdno ? `${ACTIVE_PREFIX}.${accountId}.${pdno}` : `${ACTIVE_PREFIX}.${accountId}`;
}

function presetKey(accountId: number, name: string): string {
  return `${PRESET_PREFIX}.${accountId}.${name}`;
}

function presetPrefixForAccount(accountId: number): string {
  return `${PRESET_PREFIX}.${accountId}.`;
}

/**
 * 전략 프로필 저장소 — settings 테이블에 JSON 직렬화하여 계좌별 분리 저장.
 *
 * 키 스키마:
 * - active 글로벌:  strategy.active.{accountId}
 * - active 종목별:  strategy.active.{accountId}.{pdno}
 * - preset:         strategy.preset.{accountId}.{name}
 *
 * 보안 불변식:
 * - 계좌 A의 setActive 가 계좌 B의 활성 전략에 영향을 주지 않는다.
 * - 모든 write 는 event_logs 'FSM'/'strategy.updated' 기록 (accountId/pdno + before/after diff).
 *
 * Legacy 호환:
 * - 단일 계좌 시절 키(`strategy.active`, `strategy.active.{pdno}`, `strategy.preset.{name}`)
 *   는 `migrateLegacyKeys(defaultAccountId)` 가 부팅 시 1회 이전.
 */
export class StrategyRepo {
  constructor(
    private readonly settings: SettingsRepo,
    private readonly logger: EventLogger,
  ) {}

  getActive(
    accountId: number,
    pdno: string | null,
  ): Result<StrategyProfile | null, StrategyRepoError> {
    return this.readProfile(activeKey(accountId, pdno));
  }

  setActive(
    accountId: number,
    pdno: string | null,
    profile: StrategyProfile,
  ): Result<void, StrategyRepoError> {
    const normalized = normalizeStrategyProfile(profile);
    if (!normalized) {
      const parsed = StrategyProfileSchema.safeParse(profile);
      return err({
        kind: 'VALIDATION',
        msg: parsed.success ? 'strategy profile normalize failed' : parsed.error.message,
      });
    }
    const before = this.readProfile(activeKey(accountId, pdno));
    this.settings.set(activeKey(accountId, pdno), JSON.stringify(normalized));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.updated',
      payload: {
        accountId,
        pdno: pdno ?? '__global__',
        before: before.isOk() ? before.value : null,
        after: normalized,
      },
    });
    return ok(undefined);
  }

  getEffectiveForEdit(
    accountId: number,
    pdno: string | null,
  ): Result<
    { profile: StrategyProfile; source: StrategyEffectiveSource; hasOverride: boolean },
    StrategyRepoError
  > {
    const active = this.getActive(accountId, pdno);
    if (active.isErr()) return err(active.error);
    if (active.value) {
      return ok({
        profile: active.value,
        source: pdno === null ? 'global' : 'symbol',
        hasOverride: true,
      });
    }

    if (pdno !== null) {
      const globalActive = this.getActive(accountId, null);
      if (globalActive.isErr()) return err(globalActive.error);
      if (globalActive.value) {
        return ok({ profile: globalActive.value, source: 'global', hasOverride: false });
      }
    }

    return ok({ profile: DEFAULT_STRATEGY_PROFILE, source: 'default', hasOverride: false });
  }

  clearActive(accountId: number, pdno: string | null): void {
    const before = this.readProfile(activeKey(accountId, pdno));
    this.settings.delete(activeKey(accountId, pdno));
    if (before.isOk() && before.value !== null) {
      this.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'strategy.cleared',
        payload: { accountId, pdno: pdno ?? '__global__', before: before.value },
      });
    }
  }

  /**
   * 종목별 active 전략이 없으면 글로벌 active → 기본 프로필 순서로 시드한다.
   * 이미 종목별 전략이 있으면 기존 값을 그대로 사용한다.
   */
  ensureSeededActive(
    accountId: number,
    pdno: string,
  ): Result<
    { profile: StrategyProfile; source: 'existing' | 'global' | 'default'; seeded: boolean },
    StrategyRepoError
  > {
    const existing = this.getActive(accountId, pdno);
    if (existing.isErr()) return err(existing.error);
    if (existing.value) {
      return ok({ profile: existing.value, source: 'existing', seeded: false });
    }

    const globalActive = this.getActive(accountId, null);
    if (globalActive.isErr()) return err(globalActive.error);
    const profile = globalActive.value ?? DEFAULT_STRATEGY_PROFILE;
    const source: 'global' | 'default' = globalActive.value ? 'global' : 'default';
    const saved = this.setActive(accountId, pdno, profile);
    if (saved.isErr()) return err(saved.error);
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.seeded',
      payload: { accountId, pdno, source },
    });
    return ok({ profile, source, seeded: true });
  }

  listPresets(accountId: number): Array<{ name: string; profile: StrategyProfile }> {
    const all = this.settings.list();
    const prefix = presetPrefixForAccount(accountId);
    const results: Array<{ name: string; profile: StrategyProfile }> = [];
    for (const row of all) {
      if (!row.key.startsWith(prefix)) continue;
      const name = row.key.slice(prefix.length);
      try {
        const profile = migrateLegacyStrategyProfile(JSON.parse(row.value));
        if (profile) results.push({ name, profile });
      } catch {
        // skip malformed entries — 복원 실패는 무시
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  savePreset(
    accountId: number,
    name: string,
    profile: StrategyProfile,
  ): Result<void, StrategyRepoError> {
    const normalized = normalizeStrategyProfile(profile);
    if (!normalized) {
      const parsed = StrategyProfileSchema.safeParse(profile);
      return err({
        kind: 'VALIDATION',
        msg: parsed.success ? 'strategy preset normalize failed' : parsed.error.message,
      });
    }
    if (name.length === 0 || name.length > 50) {
      return err({ kind: 'VALIDATION', msg: '프리셋 이름은 1~50자' });
    }
    this.settings.set(presetKey(accountId, name), JSON.stringify(normalized));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.preset.saved',
      payload: { accountId, name, profile: normalized },
    });
    return ok(undefined);
  }

  deletePreset(accountId: number, name: string): void {
    this.settings.delete(presetKey(accountId, name));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.preset.deleted',
      payload: { accountId, name },
    });
  }

  /**
   * 단일 계좌 시절 키를 지정된 계좌로 1회성 이전.
   * - `strategy.active` → `strategy.active.{defaultAccountId}`
   * - `strategy.active.{pdno}` → `strategy.active.{defaultAccountId}.{pdno}` (pdno 가 6자리 숫자일 때만)
   * - `strategy.preset.{name}` → `strategy.preset.{defaultAccountId}.{name}` (이미 새 키 prefix 인 것은 skip)
   *
   * 멱등 — 이미 이전된 키는 손대지 않음.
   * 부팅 시 ensureActive 후 1회 호출.
   */
  migrateLegacyKeys(defaultAccountId: number): { migrated: number } {
    const all = this.settings.list();
    let migrated = 0;
    for (const row of all) {
      const key = row.key;
      // active 글로벌
      if (key === LEGACY_ACTIVE_PREFIX) {
        const newKey = activeKey(defaultAccountId, null);
        if (this.settings.get(newKey) === null) {
          this.settings.set(newKey, row.value);
          this.settings.delete(key);
          migrated++;
        }
        continue;
      }
      // active 종목별 — strategy.active.{pdno}
      if (key.startsWith(`${LEGACY_ACTIVE_PREFIX}.`)) {
        const tail = key.slice(LEGACY_ACTIVE_PREFIX.length + 1);
        // 형식 구분:
        //   - 구 종목별: tail 이 정확히 6자리 숫자 (KIS 종목코드)
        //   - 신 글로벌:  tail 이 1~5자리 또는 7자리+ 숫자 (accountId)
        //   - 신 종목별:  tail 에 '.' 포함 (accountId.pdno)
        if (tail.includes('.')) {
          // 새 형식 (accountId.pdno). skip.
          continue;
        }
        if (/^\d{6}$/.test(tail)) {
          // 구 종목별 키.
          const newKey = activeKey(defaultAccountId, tail);
          if (this.settings.get(newKey) === null) {
            this.settings.set(newKey, row.value);
            this.settings.delete(key);
            migrated++;
          }
          continue;
        }
        // 그 외 (숫자 1~5자리 또는 7자리+ accountId 단독) → 새 형식 글로벌. skip.
        continue;
      }
      // preset
      if (key.startsWith(LEGACY_PRESET_PREFIX)) {
        const tail = key.slice(LEGACY_PRESET_PREFIX.length);
        // 새 형식: strategy.preset.{accountId}.{name} → tail 의 첫 segment 가 숫자
        const firstSeg = tail.split('.')[0];
        if (firstSeg !== undefined && /^\d+$/.test(firstSeg) && tail.includes('.')) {
          // 이미 새 형식. skip.
          continue;
        }
        const newKey = presetKey(defaultAccountId, tail);
        if (this.settings.get(newKey) === null) {
          this.settings.set(newKey, row.value);
          this.settings.delete(key);
          migrated++;
        }
      }
    }
    if (migrated > 0) {
      this.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'strategy.legacy_keys.migrated',
        payload: { accountId: defaultAccountId, count: migrated },
      });
    }
    return { migrated };
  }

  upgradeStoredProfiles(): { upgraded: number; recovered: number; autoDisabled: number } {
    const rows = this.settings.list();
    let upgraded = 0;
    let recovered = 0;
    let autoDisabled = 0;

    for (const row of rows) {
      if (!row.key.startsWith(`${ACTIVE_PREFIX}.`) && !row.key.startsWith(`${PRESET_PREFIX}.`)) {
        continue;
      }

      let nextProfile: StrategyProfile;
      let recoveredWithDefault = false;
      try {
        const raw = JSON.parse(row.value);
        const migrated = migrateLegacyStrategyProfile(raw);
        if (migrated) {
          nextProfile = migrated;
        } else {
          nextProfile = DEFAULT_STRATEGY_PROFILE;
          recoveredWithDefault = true;
        }
      } catch {
        nextProfile = DEFAULT_STRATEGY_PROFILE;
        recoveredWithDefault = true;
      }

      if (row.key.startsWith(`${ACTIVE_PREFIX}.`) && isUnsafeDefaultAutoProfile(nextProfile)) {
        nextProfile = {
          ...nextProfile,
          autoBuyEnabled: false,
          autoSellEnabled: false,
        };
        autoDisabled += 1;
      }

      const normalized = JSON.stringify(nextProfile);
      if (normalized === row.value) continue;

      this.settings.set(row.key, normalized);
      if (recoveredWithDefault) {
        recovered += 1;
        this.logger.log({
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
      this.logger.log({
        level: recovered > 0 ? 'WARN' : 'INFO',
        category: 'FSM',
        message: 'strategy.migration.completed',
        payload: { upgraded, recovered, autoDisabled },
      });
    }
    if (autoDisabled > 0) {
      this.logger.log({
        level: 'WARN',
        category: 'FSM',
        message: 'strategy.default_auto.disabled',
        payload: { count: autoDisabled },
      });
    }
    return { upgraded, recovered, autoDisabled };
  }

  backfillMissingActiveProfiles(
    accountId: number,
    pdnos: string[],
  ): { seeded: number; failed: number } {
    let seeded = 0;
    let failed = 0;
    const uniquePdnos = Array.from(new Set(pdnos)).sort((a, b) => a.localeCompare(b));
    for (const pdno of uniquePdnos) {
      const seededResult = this.ensureSeededActive(accountId, pdno);
      if (seededResult.isErr()) {
        failed += 1;
        this.logger.log({
          level: 'ERROR',
          category: 'FSM',
          message: 'strategy.backfill.failed',
          payload: { accountId, pdno, reason: seededResult.error.kind },
        });
        continue;
      }
      if (seededResult.value.seeded) seeded += 1;
    }

    if (seeded > 0 || failed > 0) {
      this.logger.log({
        level: failed > 0 ? 'WARN' : 'INFO',
        category: 'FSM',
        message: 'strategy.backfill.completed',
        payload: { accountId, seeded, failed },
      });
    }
    return { seeded, failed };
  }

  private readProfile(key: string): Result<StrategyProfile | null, StrategyRepoError> {
    const raw = this.settings.get(key);
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
}

function isUnsafeDefaultAutoProfile(profile: StrategyProfile): boolean {
  if (!profile.autoBuyEnabled || !profile.autoSellEnabled) return false;
  const disabled = {
    ...profile,
    autoBuyEnabled: false,
    autoSellEnabled: false,
  };
  return JSON.stringify(disabled) === JSON.stringify(DEFAULT_STRATEGY_PROFILE);
}
