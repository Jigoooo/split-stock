export const ACTIVE_STAGE_STATUSES = ['OPEN', 'BUYING'] as const;

export type ActiveStageStatus = (typeof ACTIVE_STAGE_STATUSES)[number];

export interface StageLike {
  nth: number;
  status: string;
}

/**
 * 현재 보유/매수중 차수 기준으로 다음 매수 차수를 계산한다.
 * - OPEN/BUYING이 없으면 새 사이클이므로 1차
 * - 있으면 활성 차수의 최대 nth + 1
 */
export function deriveNextBuyNth(lots: ReadonlyArray<StageLike>): number {
  let nextNth = 1;
  for (const lot of lots) {
    if (!ACTIVE_STAGE_STATUSES.includes(lot.status as ActiveStageStatus)) continue;
    nextNth = Math.max(nextNth, lot.nth + 1);
  }
  return nextNth;
}
