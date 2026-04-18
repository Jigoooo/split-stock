import type { StrategyProfile } from '@shared/contracts';
import { StrategyProfileSchema } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { SettingsRepo } from '../db/settings-repo';
import type { EventLogger } from '../logging/event-logger';

export type StrategyRepoError =
  | { kind: 'VALIDATION'; msg: string }
  | { kind: 'PARSE_FAILED'; cause: unknown };

const ACTIVE_PREFIX = 'strategy.active';
const PRESET_PREFIX = 'strategy.preset.';

function activeKey(pdno: string | null): string {
  return pdno ? `${ACTIVE_PREFIX}.${pdno}` : ACTIVE_PREFIX;
}

function presetKey(name: string): string {
  return `${PRESET_PREFIX}${name}`;
}

/**
 * 전략 프로필 저장소 — settings 테이블에 JSON 직렬화하여 저장.
 * - active: 글로벌(pdno=null) 또는 종목별 현재 전략
 * - preset: 이름 붙인 재사용 가능 프로필
 * - 모든 write는 event_logs 'FSM'/'strategy.updated' 기록 (pdno + before/after diff)
 */
export class StrategyRepo {
  constructor(
    private readonly settings: SettingsRepo,
    private readonly logger: EventLogger,
  ) {}

  getActive(pdno: string | null): Result<StrategyProfile | null, StrategyRepoError> {
    return this.readProfile(activeKey(pdno));
  }

  setActive(pdno: string | null, profile: StrategyProfile): Result<void, StrategyRepoError> {
    const parsed = StrategyProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', msg: parsed.error.message });
    }
    const before = this.readProfile(activeKey(pdno));
    this.settings.set(activeKey(pdno), JSON.stringify(parsed.data));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.updated',
      payload: {
        pdno: pdno ?? '__global__',
        before: before.isOk() ? before.value : null,
        after: parsed.data,
      },
    });
    return ok(undefined);
  }

  clearActive(pdno: string | null): void {
    const before = this.readProfile(activeKey(pdno));
    this.settings.delete(activeKey(pdno));
    if (before.isOk() && before.value !== null) {
      this.logger.log({
        level: 'INFO',
        category: 'FSM',
        message: 'strategy.cleared',
        payload: { pdno: pdno ?? '__global__', before: before.value },
      });
    }
  }

  listPresets(): Array<{ name: string; profile: StrategyProfile }> {
    const all = this.settings.list();
    const results: Array<{ name: string; profile: StrategyProfile }> = [];
    for (const row of all) {
      if (!row.key.startsWith(PRESET_PREFIX)) continue;
      const name = row.key.slice(PRESET_PREFIX.length);
      try {
        const parsed = StrategyProfileSchema.safeParse(JSON.parse(row.value));
        if (parsed.success) {
          results.push({ name, profile: parsed.data });
        }
      } catch {
        // skip malformed entries — 복원 실패는 무시
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  savePreset(name: string, profile: StrategyProfile): Result<void, StrategyRepoError> {
    const parsed = StrategyProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return err({ kind: 'VALIDATION', msg: parsed.error.message });
    }
    if (name.length === 0 || name.length > 50) {
      return err({ kind: 'VALIDATION', msg: '프리셋 이름은 1~50자' });
    }
    this.settings.set(presetKey(name), JSON.stringify(parsed.data));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.preset.saved',
      payload: { name, profile: parsed.data },
    });
    return ok(undefined);
  }

  deletePreset(name: string): void {
    this.settings.delete(presetKey(name));
    this.logger.log({
      level: 'INFO',
      category: 'FSM',
      message: 'strategy.preset.deleted',
      payload: { name },
    });
  }

  private readProfile(key: string): Result<StrategyProfile | null, StrategyRepoError> {
    const raw = this.settings.get(key);
    if (raw === null) return ok(null);
    try {
      const parsed = StrategyProfileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return err({ kind: 'PARSE_FAILED', cause: parsed.error.message });
      }
      return ok(parsed.data);
    } catch (cause) {
      return err({ kind: 'PARSE_FAILED', cause });
    }
  }
}
