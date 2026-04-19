import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
// `sql` 은 raw UPDATE 시뮬레이션용으로 아래 ensureActive 테스트에서 사용된다.
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { ActiveAccountRepo } from './active-account';

function setup() {
  const db = createTestDb();
  bootstrapSchema(db);
  return { db, repo: new ActiveAccountRepo(db) };
}

describe('ActiveAccountRepo', () => {
  it('계좌 0개 — getActiveAccountId 는 null, ensureActive 는 NO_ACCOUNT', () => {
    const { repo } = setup();
    expect(repo.getActiveAccountId()).toBeNull();
    const r = repo.ensureActive();
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NO_ACCOUNT');
  });

  it('upsertFromCredentials — 첫 계좌 자동 활성화', () => {
    const { repo } = setup();
    const id = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    expect(id.isOk()).toBe(true);
    if (id.isOk()) {
      expect(repo.getActiveAccountId()).toBe(id.value);
    }
  });

  it('upsertFromCredentials — 같은 키 두 번 호출은 단일 계좌만 생성', () => {
    const { repo } = setup();
    const a = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    const b = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    expect(a.isOk() && b.isOk()).toBe(true);
    if (a.isOk() && b.isOk()) expect(a.value).toBe(b.value);
    expect(repo.list()).toHaveLength(1);
  });

  it('upsertFromCredentials — 두 번째 계좌는 비활성으로 추가', () => {
    const { repo } = setup();
    const a = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    const b = repo.upsertFromCredentials({
      env: 'PROD',
      accountNo8: '99999999',
      accountProdCd: '01',
    });
    expect(a.isOk() && b.isOk()).toBe(true);
    if (a.isOk() && b.isOk()) {
      expect(repo.getActiveAccountId()).toBe(a.value);
      const accountB = repo.getById(b.value);
      expect(accountB?.isActive).toBe(false);
    }
  });

  it('setActiveAccountId — 트랜잭션으로 단일 활성 보장', () => {
    const { repo } = setup();
    const a = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    const b = repo.upsertFromCredentials({
      env: 'PROD',
      accountNo8: '99999999',
      accountProdCd: '01',
    });
    if (!(a.isOk() && b.isOk())) throw new Error('seed failed');

    const r = repo.setActiveAccountId(b.value);
    expect(r.isOk()).toBe(true);
    expect(repo.getActiveAccountId()).toBe(b.value);
    expect(repo.getById(a.value)?.isActive).toBe(false);
    expect(repo.getById(b.value)?.isActive).toBe(true);
  });

  it('setActiveAccountId — 존재하지 않는 ID 는 NOT_FOUND', () => {
    const { repo } = setup();
    repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    const r = repo.setActiveAccountId(9999);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NOT_FOUND');
  });

  it('ensureActive — 활성 계좌 없으면 첫 계좌 활성화', () => {
    const { db, repo } = setup();
    const a = repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    if (!a.isOk()) throw new Error('seed failed');
    // 활성을 강제로 0 으로 (이상 상태 시뮬).
    db.run(sql.raw('UPDATE accounts SET is_active = 0'));

    const r = repo.ensureActive();
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(a.value);
    expect(repo.getActiveAccountId()).toBe(a.value);
  });

  it('ensureActive — 활성 2개 이상은 첫 계좌만 남김 (단일성 복구)', () => {
    const { db, repo } = setup();
    repo.upsertFromCredentials({
      env: 'MOCK',
      accountNo8: '12345678',
      accountProdCd: '01',
    });
    repo.upsertFromCredentials({
      env: 'PROD',
      accountNo8: '99999999',
      accountProdCd: '01',
    });
    // 양쪽 모두 활성으로 강제 (이상 상태).
    db.run(sql.raw('UPDATE accounts SET is_active = 1'));

    const r = repo.ensureActive();
    expect(r.isOk()).toBe(true);
    const all = repo.list();
    const active = all.filter((a) => a.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(all[0]?.id); // 첫 계좌
  });
});
