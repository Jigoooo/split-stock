import type { StrategyProfile } from '@shared/contracts';
import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import type { LotsRepo } from './lots-repo';
import { resolveStrategyProfile } from './strategy-profile-resolver';
import type { StrategyRepo } from './strategy-repo';

/**
 * NM-016 catch-up detector — 부팅 시 1회 scan.
 *
 * 프로그램 비가동 중 가격이 다수 차수 trigger 까지 떨어진 종목을 감지.
 * 매직스플릿 룰 (직전차수 × (1-triggerDropPct)) 을 chain 으로 평가해 도달한 최대 차수 N 산출.
 *
 * **자동 진입 절대 금지** — 결과는 사용자 다이얼로그용 데이터만. 실제 주문은 사용자 confirm 후.
 */

export interface CatchUpLotInfo {
  nth: number;
  buyPrice: number;
}

export interface CatchUpTriggerInfo {
  nth: number;
  /** 직전차수 buyPrice * (1 - triggerDropPct). */
  triggerPrice: number;
  /** 현재가 ≤ triggerPrice 이면 true. */
  reached: boolean;
}

export interface CatchUpItem {
  accountId: number;
  pdno: string;
  /** 종목명 — stockMasterRepo lookup. 없으면 pdno 그대로. */
  name: string;
  currentPrice: number;
  /** 현재 보유 중인 active 차수들 (OPEN/BUYING/SELLING). nth 오름차순. */
  lots: CatchUpLotInfo[];
  /** 평가된 다음 차수 trigger 들. reached=true 인 가장 큰 nth = maxReachedNth. */
  triggers: CatchUpTriggerInfo[];
  /** 도달한 최대 차수 (없으면 null = catch-up 대상 아님). */
  maxReachedNth: number | null;
}

export interface CatchUpDetectorDeps {
  lotsRepo: LotsRepo;
  strategyRepo: StrategyRepo;
  /** pdno → 현재가 (최근 tick 또는 REST 캐시). null = 가격 미확보 (skip). */
  getCurrentPrice: (pdno: string) => number | null;
  /** pdno → 종목명. 없으면 pdno 그대로 사용. */
  resolveStockName?: (pdno: string) => string | null;
}

/**
 * 단일 종목에 대해 도달한 최대 차수 산출.
 * 1차는 수동 진입이라 evaluate 안 함. 2차부터 chain.
 */
export function evaluateCatchUpForSymbol(
  accountId: number,
  pdno: string,
  currentPrice: number,
  activeLots: CatchUpLotInfo[],
  profile: StrategyProfile,
  name: string,
): CatchUpItem | null {
  if (activeLots.length === 0) return null;
  if (currentPrice <= 0) return null;

  // top = 가장 높은 차수 (= 다음 매수 평가 기준)
  const top = activeLots.reduce((acc, lot) => (lot.nth > acc.nth ? lot : acc), activeLots[0]!);
  if (top.nth >= profile.maxStages) return null;

  const triggers: CatchUpTriggerInfo[] = [];
  let prevBuyPrice = top.buyPrice;
  let maxReachedNth: number | null = null;
  for (let nextNth = top.nth + 1; nextNth <= profile.maxStages; nextNth += 1) {
    const rule = profile.buyRules.find((r) => r.nth === nextNth);
    if (!rule || rule.triggerDropPct === null) break;
    const triggerPrice = Math.floor(prevBuyPrice * (1 - rule.triggerDropPct));
    const reached = currentPrice <= triggerPrice;
    triggers.push({ nth: nextNth, triggerPrice, reached });
    if (reached) {
      maxReachedNth = nextNth;
      // chain: 다음 차수 evaluation 의 base 는 이번 trigger price (실제 매수가는 trigger 이하지만
      // 매직스플릿 룰상 기록 매입가는 trigger price 로 가정 — 실제 catch-up 진입 시 동일 가정)
      prevBuyPrice = triggerPrice;
    } else {
      // 한 단계라도 미도달이면 chain 중단 — 더 깊은 차수도 의미 없음
      break;
    }
  }

  return {
    accountId,
    pdno,
    name,
    currentPrice,
    lots: [...activeLots].sort((a, b) => a.nth - b.nth),
    triggers,
    maxReachedNth,
  };
}

/**
 * 활성 계좌의 모든 종목에 대해 catch-up scan. maxReachedNth ≥ 2 인 항목만 반환.
 */
export function scanCatchUp(deps: CatchUpDetectorDeps, accountId: number): readonly CatchUpItem[] {
  const allLots = deps.lotsRepo.listRows(accountId);
  if (allLots.isErr()) return [];

  const byPdno = new Map<string, CatchUpLotInfo[]>();
  for (const row of allLots.value) {
    if (!ACTIVE_CYCLE_STATUSES.includes(row.status as ActiveCycleStatus)) continue;
    const list = byPdno.get(row.pdno) ?? [];
    list.push({ nth: row.nth, buyPrice: row.buyPrice });
    byPdno.set(row.pdno, list);
  }

  const items: CatchUpItem[] = [];
  for (const [pdno, lots] of byPdno) {
    const profile = resolveStrategyProfile(deps.strategyRepo, accountId, pdno);
    if (!profile) continue;
    const currentPrice = deps.getCurrentPrice(pdno);
    if (currentPrice === null) continue;
    const name = deps.resolveStockName?.(pdno) ?? pdno;

    const item = evaluateCatchUpForSymbol(accountId, pdno, currentPrice, lots, profile, name);
    if (item && item.maxReachedNth !== null) {
      items.push(item);
    }
  }

  return items;
}
