import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { PrebuyRepo } from './prebuy-repo';

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new PrebuyRepo(db);
}

const base = (p: Partial<Parameters<PrebuyRepo['insert']>[0]> = {}) => ({
  accountId: 1,
  pdno: '005930',
  targetPrice: 60_000,
  amountKrw: 1_000_000,
  validUntil: new Date('2030-01-01'),
  ...p,
});

describe('PrebuyRepo', () => {
  it('insert + listPending 라운드트립', () => {
    const repo = fresh();
    const r = repo.insert(base());
    expect(r.isOk()).toBe(true);

    const pending = repo.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.accountId).toBe(1);
    expect(pending[0]?.pdno).toBe('005930');
    expect(pending[0]?.status).toBe('PENDING');
  });

  it('동일 pdno PENDING 중복 → DUPLICATE_PENDING 에러', () => {
    const repo = fresh();
    repo.insert(base());
    const r = repo.insert(base({ targetPrice: 50_000 }));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('DUPLICATE_PENDING');
    }
  });

  it('다른 accountId 의 동일 pdno 는 중복 아님', () => {
    const repo = fresh();
    repo.insert(base());
    const r = repo.insert(base({ accountId: 2 }));
    expect(r.isOk()).toBe(true);
  });

  it('CANCELLED 이후 동일 pdno는 재등록 가능', () => {
    const repo = fresh();
    const first = repo.insert(base());
    if (first.isErr()) throw new Error('seed');
    const cancel = repo.cancel(first.value);
    expect(cancel.isOk()).toBe(true);

    const second = repo.insert(base({ targetPrice: 55_000 }));
    expect(second.isOk()).toBe(true);
  });

  it('최대 100건 초과 → CAP_EXCEEDED', () => {
    const repo = fresh();
    for (let i = 0; i < 100; i++) {
      const pdno = String(100000 + i).padStart(6, '0');
      repo.insert(base({ pdno }));
    }
    const over = repo.insert(base({ pdno: '900001' }));
    expect(over.isErr()).toBe(true);
    if (over.isErr()) {
      expect(over.error.kind).toBe('CAP_EXCEEDED');
    }
  });

  it('markFilled / markExpired 전이', () => {
    const repo = fresh();
    const a = repo.insert(base({ pdno: '000001' }));
    const b = repo.insert(base({ pdno: '000002' }));
    if (a.isErr() || b.isErr()) throw new Error('seed');

    expect(repo.markFilled(a.value).isOk()).toBe(true);
    expect(repo.markExpired(b.value).isOk()).toBe(true);

    const pending = repo.listPending();
    expect(pending).toHaveLength(0);
  });

  it('markFilled(없는 id) → NOT_FOUND', () => {
    const repo = fresh();
    const r = repo.markFilled(9999);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe('NOT_FOUND');
  });
});
