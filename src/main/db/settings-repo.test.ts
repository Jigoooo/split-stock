import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from './bootstrap-schema';
import { createTestDb } from './client';
import {
  PENDING_CANCEL_DEFAULTS,
  readPendingCancelConfig,
  SETTING_KEYS,
  SettingsRepo,
} from './settings-repo';

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new SettingsRepo(db);
}

describe('SettingsRepo', () => {
  it('get/set/delete 라운드트립', () => {
    const repo = fresh();
    expect(repo.get('x')).toBeNull();
    repo.set('x', '1');
    expect(repo.get('x')).toBe('1');
    repo.set('x', '2'); // update
    expect(repo.get('x')).toBe('2');
    repo.delete('x');
    expect(repo.get('x')).toBeNull();
  });
});

describe('readPendingCancelConfig', () => {
  it('값 없으면 기본값', () => {
    const repo = fresh();
    const cfg = readPendingCancelConfig(repo);
    expect(cfg.timeoutMs).toBe(PENDING_CANCEL_DEFAULTS.timeoutMin * 60_000);
    expect(cfg.maxRetries).toBe(PENDING_CANCEL_DEFAULTS.maxRetries);
  });

  it('정상 범위 값 적용', () => {
    const repo = fresh();
    repo.set(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN, '15');
    repo.set(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES, '10');
    const cfg = readPendingCancelConfig(repo);
    expect(cfg.timeoutMs).toBe(15 * 60_000);
    expect(cfg.maxRetries).toBe(10);
  });

  it('unlimited 문자열 → null 반환', () => {
    const repo = fresh();
    repo.set(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES, 'unlimited');
    expect(readPendingCancelConfig(repo).maxRetries).toBeNull();
  });

  it('범위 벗어난 값은 기본값으로 fallback', () => {
    const repo = fresh();
    repo.set(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN, '999');
    repo.set(SETTING_KEYS.PENDING_CANCEL_MAX_RETRIES, '0');
    const cfg = readPendingCancelConfig(repo);
    expect(cfg.timeoutMs).toBe(PENDING_CANCEL_DEFAULTS.timeoutMin * 60_000);
    expect(cfg.maxRetries).toBe(PENDING_CANCEL_DEFAULTS.maxRetries);
  });

  it('숫자 파싱 실패 (문자열 "abc") → 기본값', () => {
    const repo = fresh();
    repo.set(SETTING_KEYS.PENDING_CANCEL_TIMEOUT_MIN, 'abc');
    expect(readPendingCancelConfig(repo).timeoutMs).toBe(
      PENDING_CANCEL_DEFAULTS.timeoutMin * 60_000,
    );
  });
});
