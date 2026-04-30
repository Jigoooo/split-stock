import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';
import { activeKey, activePrefixForAccount } from './strategy-repo-keys';
import {
  migrateLegacyStrategyKeys,
  upgradeStoredStrategyProfiles,
} from './strategy-repo-migration';
import { hasSameAutoControls } from './strategy-repo-policy';
import {
  deleteStrategyPreset,
  listStrategyPresets,
  saveStrategyPreset,
} from './strategy-repo-presets';
import { normalizeStrategyProfileForSave, readStrategyProfile } from './strategy-repo-read';

export type StrategyRepoError =
  | { kind: 'VALIDATION'; msg: string }
  | { kind: 'PARSE_FAILED'; cause: unknown };

export type StrategyEffectiveSource = 'symbol' | 'global' | 'default';

export type StrategyAutoControls = Pick<
  StrategyProfile,
  'autoBuyEnabled' | 'autoBuyOrderType' | 'autoSellEnabled' | 'autoSellOrderType'
>;

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
    const normalized = normalizeStrategyProfileForSave(
      profile,
      'strategy profile normalize failed',
    );
    if (normalized.isErr()) return err(normalized.error);
    const before = this.readProfile(activeKey(accountId, pdno));
    this.settings.set(activeKey(accountId, pdno), JSON.stringify(normalized.value));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.updated',
      payload: {
        accountId,
        pdno: pdno ?? '__global__',
        before: before.isOk() ? before.value : null,
        after: normalized.value,
      },
    });
    return ok(undefined);
  }

  applyAutoControlsToSymbolActives(
    accountId: number,
    controls: StrategyAutoControls,
  ): { updated: number; failed: number } {
    const prefix = activePrefixForAccount(accountId);
    let updated = 0;
    let failed = 0;

    for (const row of this.settings.list()) {
      if (!row.key.startsWith(prefix)) continue;
      const pdno = row.key.slice(prefix.length);
      if (!/^\d{6}$/.test(pdno)) continue;

      const current = this.readProfile(row.key);
      if (current.isErr() || current.value === null) {
        failed += 1;
        this.logger.log({
          level: 'ERROR',
          category: 'FSM',
          message: 'strategy.auto_controls.apply_failed',
          payload: {
            accountId,
            pdno,
            reason: current.isErr() ? current.error.kind : 'MISSING_PROFILE',
          },
        });
        continue;
      }

      if (hasSameAutoControls(current.value, controls)) continue;

      const saved = this.setActive(accountId, pdno, {
        ...current.value,
        ...controls,
      });
      if (saved.isErr()) {
        failed += 1;
        this.logger.log({
          level: 'ERROR',
          category: 'FSM',
          message: 'strategy.auto_controls.apply_failed',
          payload: { accountId, pdno, reason: saved.error.kind },
        });
        continue;
      }
      updated += 1;
    }

    if (updated > 0 || failed > 0) {
      this.logger.log({
        level: failed > 0 ? 'WARN' : 'INFO',
        category: 'FSM',
        message: 'strategy.auto_controls.applied',
        payload: { accountId, updated, failed, controls },
      });
    }

    return { updated, failed };
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
    return listStrategyPresets(this.settings, accountId);
  }

  savePreset(
    accountId: number,
    name: string,
    profile: StrategyProfile,
  ): Result<void, StrategyRepoError> {
    return saveStrategyPreset(this.settings, this.logger, accountId, name, profile);
  }

  deletePreset(accountId: number, name: string): void {
    deleteStrategyPreset(this.settings, this.logger, accountId, name);
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
    return migrateLegacyStrategyKeys(this.settings, this.logger, defaultAccountId);
  }

  upgradeStoredProfiles(): { upgraded: number; recovered: number; autoDisabled: number } {
    return upgradeStoredStrategyProfiles(this.settings, this.logger);
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
    return readStrategyProfile(this.settings, key);
  }
}
