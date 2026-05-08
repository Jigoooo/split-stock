import { z } from 'zod';
import { SETTING_KEYS } from './settings-keys';
import type { SettingsRepo } from './settings-repo';

/**
 * NM-016 catch-up 통합 다이얼로그 — "나중에 결정" 시 영속화되는 pending batch.
 * 다음 부팅 시 scanCatchUp 결과와 합쳐 모달 재노출.
 *
 * 영속화 데이터는 scan 결과 그대로가 아닌 minimal subset (accountId, pdno, name, maxReachedNth, savedAt).
 * - 가격/triggers 는 부팅 시 다시 evaluate (가격이 그동안 회복됐을 수 있음 → 신선한 평가 필요).
 * - 사용자 의사 표시 ("이 종목 결정 미뤘음") 만 보존.
 */

const CatchUpPendingItemSchema = z.object({
  accountId: z.number().int().positive(),
  pdno: z.string().regex(/^\d{6}$/),
  name: z.string(),
  maxReachedNth: z.number().int().positive().nullable(),
  /** epoch millis. 너무 오래된 batch 자동 만료 처리 가능 (현재는 만료 미적용). */
  savedAt: z.number().int().positive(),
});
export type CatchUpPendingItem = z.infer<typeof CatchUpPendingItemSchema>;

const CatchUpPendingBatchSchema = z.object({
  version: z.literal(1),
  items: z.array(CatchUpPendingItemSchema),
});
export type CatchUpPendingBatch = z.infer<typeof CatchUpPendingBatchSchema>;

/**
 * pending batch 읽기 — 미저장 / 손상 시 null.
 * 손상 시 silent drop (다음 부팅에서 새로 평가).
 */
export function readCatchUpPending(repo: SettingsRepo): CatchUpPendingBatch | null {
  const raw = repo.get(SETTING_KEYS.CATCH_UP_PENDING);
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = CatchUpPendingBatchSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * pending batch 저장. items.length === 0 이면 삭제.
 */
export function writeCatchUpPending(
  repo: SettingsRepo,
  items: ReadonlyArray<Omit<CatchUpPendingItem, 'savedAt'>>,
  now: () => number = Date.now,
): void {
  if (items.length === 0) {
    clearCatchUpPending(repo);
    return;
  }
  const savedAt = now();
  const batch: CatchUpPendingBatch = {
    version: 1,
    items: items.map((item) => ({
      accountId: item.accountId,
      pdno: item.pdno,
      name: item.name,
      maxReachedNth: item.maxReachedNth,
      savedAt,
    })),
  };
  repo.set(SETTING_KEYS.CATCH_UP_PENDING, JSON.stringify(batch));
}

export function clearCatchUpPending(repo: SettingsRepo): void {
  repo.delete(SETTING_KEYS.CATCH_UP_PENDING);
}
