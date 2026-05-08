import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from './bootstrap-schema';
import { createTestDb } from './client';
import { clearCatchUpPending, readCatchUpPending, writeCatchUpPending } from './settings-catch-up';
import { SettingsRepo } from './settings-repo';

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new SettingsRepo(db);
}

const ITEM = {
  accountId: 1,
  pdno: '005930',
  name: '삼성전자',
  maxReachedNth: 3,
} as const;

describe('readCatchUpPending', () => {
  it('저장 전에는 null 반환', () => {
    const repo = fresh();
    expect(readCatchUpPending(repo)).toBeNull();
  });

  it('저장 후 round-trip — version/items 일치', () => {
    const repo = fresh();
    const fixedNow = () => 1_700_000_000_000;
    writeCatchUpPending(repo, [ITEM], fixedNow);
    const batch = readCatchUpPending(repo);
    expect(batch).not.toBeNull();
    expect(batch?.version).toBe(1);
    expect(batch?.items).toHaveLength(1);
    expect(batch?.items[0]).toMatchObject({
      accountId: 1,
      pdno: '005930',
      name: '삼성전자',
      maxReachedNth: 3,
      savedAt: 1_700_000_000_000,
    });
  });

  it('items 빈 배열 저장 시 delete (readCatchUpPending → null)', () => {
    const repo = fresh();
    writeCatchUpPending(repo, [ITEM]);
    writeCatchUpPending(repo, []);
    expect(readCatchUpPending(repo)).toBeNull();
  });

  it('손상된 JSON 은 null 반환 (silent drop)', () => {
    const repo = fresh();
    repo.set('catch_up.pending', 'NOT_JSON');
    expect(readCatchUpPending(repo)).toBeNull();
  });

  it('version 불일치 batch 는 null 반환', () => {
    const repo = fresh();
    repo.set('catch_up.pending', JSON.stringify({ version: 99, items: [] }));
    expect(readCatchUpPending(repo)).toBeNull();
  });
});

describe('clearCatchUpPending', () => {
  it('저장 후 clear 하면 null', () => {
    const repo = fresh();
    writeCatchUpPending(repo, [ITEM]);
    clearCatchUpPending(repo);
    expect(readCatchUpPending(repo)).toBeNull();
  });

  it('미저장 상태에서 clear 는 throw 없음', () => {
    const repo = fresh();
    expect(() => clearCatchUpPending(repo)).not.toThrow();
  });
});

describe('writeCatchUpPending', () => {
  it('여러 items 저장', () => {
    const repo = fresh();
    const items = [ITEM, { accountId: 2, pdno: '000660', name: 'SK하이닉스', maxReachedNth: null }];
    writeCatchUpPending(repo, items);
    const batch = readCatchUpPending(repo);
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items[1]?.maxReachedNth).toBeNull();
  });

  it('덮어쓰기 — 두 번째 write 가 최신 값 반환', () => {
    const repo = fresh();
    writeCatchUpPending(repo, [ITEM]);
    const updated = { ...ITEM, maxReachedNth: 5 };
    writeCatchUpPending(repo, [updated]);
    const batch = readCatchUpPending(repo);
    expect(batch?.items[0]?.maxReachedNth).toBe(5);
  });
});
