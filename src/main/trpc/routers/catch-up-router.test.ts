import { describe, expect, it } from 'vitest';
import type { CatchUpPendingItem } from '../../db/settings-catch-up';
import type { CatchUpItem } from '../../trading/catch-up-detector';

/**
 * NM-016 catch-up-router 의 mergeWithPending 로직 단위 테스트.
 *
 * mergeWithPending 은 router 내 파일-스코프 함수이므로 로직을 인라인으로 검증.
 * 동일 (accountId, pdno) 는 fresh 우선, pending-only 항목은 placeholder.
 */
function mergeWithPending(
  fresh: readonly CatchUpItem[],
  pending: readonly CatchUpPendingItem[],
): CatchUpItem[] {
  const seen = new Set<string>();
  const result: CatchUpItem[] = [];
  for (const item of fresh) {
    const key = `${item.accountId}:${item.pdno}`;
    seen.add(key);
    result.push(item);
  }
  for (const p of pending) {
    const key = `${p.accountId}:${p.pdno}`;
    if (seen.has(key)) continue;
    result.push({
      accountId: p.accountId,
      pdno: p.pdno,
      name: p.name,
      currentPrice: 0,
      lots: [],
      triggers: [],
      maxReachedNth: p.maxReachedNth,
    });
  }
  return result;
}

const makeFresh = (pdno: string, price = 70_000): CatchUpItem => ({
  accountId: 1,
  pdno,
  name: `종목_${pdno}`,
  currentPrice: price,
  lots: [],
  triggers: [],
  maxReachedNth: 2,
});

const makePending = (pdno: string, nth: number | null = 2): CatchUpPendingItem => ({
  accountId: 1,
  pdno,
  name: `종목_${pdno}`,
  maxReachedNth: nth,
  savedAt: Date.now(),
});

describe('mergeWithPending', () => {
  it('fresh 만 있으면 그대로 반환', () => {
    const result = mergeWithPending([makeFresh('005930')], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.currentPrice).toBe(70_000);
  });

  it('pending 만 있으면 placeholder 로 반환 (currentPrice=0, lots/triggers 빈 배열)', () => {
    const result = mergeWithPending([], [makePending('005930')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.currentPrice).toBe(0);
    expect(result[0]?.lots).toEqual([]);
    expect(result[0]?.triggers).toEqual([]);
  });

  it('동일 (accountId, pdno) 는 fresh 우선', () => {
    const fresh = makeFresh('005930', 68_000);
    const pending = makePending('005930', 5);
    const result = mergeWithPending([fresh], [pending]);
    expect(result).toHaveLength(1);
    expect(result[0]?.currentPrice).toBe(68_000); // fresh 의 값
    expect(result[0]?.maxReachedNth).toBe(2); // fresh 의 값
  });

  it('fresh 에 없는 pending 항목은 placeholder 로 추가', () => {
    const result = mergeWithPending([makeFresh('005930')], [makePending('000660')]);
    expect(result).toHaveLength(2);
    const placeholder = result.find((r) => r.pdno === '000660')!;
    expect(placeholder.currentPrice).toBe(0);
  });

  it('fresh 와 pending 에 모두 있는 항목은 중복 없이 fresh 1개만', () => {
    const result = mergeWithPending(
      [makeFresh('005930'), makeFresh('000660')],
      [makePending('005930'), makePending('035720')],
    );
    // 005930: fresh, 000660: fresh, 035720: pending placeholder
    expect(result).toHaveLength(3);
    const pdnos = result.map((r) => r.pdno);
    expect(pdnos.filter((p) => p === '005930')).toHaveLength(1);
  });

  it('빈 fresh + 빈 pending → 빈 배열', () => {
    expect(mergeWithPending([], [])).toEqual([]);
  });

  it('maxReachedNth null 인 pending 항목도 올바르게 처리', () => {
    const result = mergeWithPending([], [makePending('005930', null)]);
    expect(result[0]?.maxReachedNth).toBeNull();
  });
});
