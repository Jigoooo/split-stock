import type { StrategyBuyRule, StrategySellRule } from '@shared/contracts/strategy';
import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import { z } from 'zod';

export const TradingConfigSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/, '종목코드 6자리'),
  maxStages: z.number().int().min(1).max(50),
  buyRules: z
    .array(
      z.object({
        nth: z.number().int().min(1).max(50),
        triggerDropPct: z.number().positive().max(0.5).nullable(),
        amountKrw: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
  sellRules: z
    .array(
      z.object({
        nth: z.number().int().min(1).max(50),
        targetProfitPct: z.number().positive().max(0.5),
      }),
    )
    .min(1)
    .max(50),
});
export type TradingConfig = z.infer<typeof TradingConfigSchema>;

export type LotStatus = 'OPEN' | 'SOLD' | 'BUYING' | 'SELLING';

export interface LotSnapshot {
  nth: number;
  buyPrice: number;
  qty: number;
  status: LotStatus;
}

export interface PositionSnapshot {
  pdno: string;
  lots: LotSnapshot[];
}

export type OrderKind = 'BUY' | 'SELL';

export interface FsmOrder {
  kind: OrderKind;
  pdno: string;
  nth: number;
  price: number; // 지정가 (시장가가 필요하면 호출측이 division 변환)
  qty: number;
}

function qtyForPrice(amount: number, price: number): number {
  if (price <= 0) return 0;
  return Math.floor(amount / price);
}

function highestLot(lots: LotSnapshot[]): LotSnapshot | null {
  if (lots.length === 0) return null;
  let top = lots[0];
  for (const l of lots) {
    if (!top || l.nth > top.nth) top = l;
  }
  return top ?? null;
}

function findBuyRule(rules: StrategyBuyRule[], nth: number): StrategyBuyRule | null {
  return rules.find((rule) => rule.nth === nth) ?? null;
}

function findSellRule(rules: StrategySellRule[], nth: number): StrategySellRule | null {
  return rules.find((rule) => rule.nth === nth) ?? null;
}

/**
 * 주어진 현재가, 포지션 스냅샷, 설정을 바탕으로 생성해야 할 주문 목록을 반환.
 *
 * 규칙:
 * 1) 1차는 수동 진입이므로 포지션 전무일 때는 주문을 만들지 않는다.
 * 2) 직전 차수 매수가 × (1-nextRule.triggerDropPct) 이하로 하락 → 해당 next nth 매수
 * 3) OPEN 상태 각 차수 매입가 × (1+sellRule.targetProfitPct) 이상 상승 → 해당 차수 매도
 * 4) BUYING/SELLING 상태는 재평가하지 않음 (중복 주문 방지)
 * 5) 매수/매도 조건은 동시 성립 가능 — 매수/매도 모두 emit
 */
export function evaluate(
  price: number,
  position: PositionSnapshot,
  cfg: TradingConfig,
): FsmOrder[] {
  if (!Number.isFinite(price) || price <= 0) return [];
  if (position.pdno !== cfg.pdno) return [];

  const orders: FsmOrder[] = [];
  const activeLots = position.lots.filter((l) =>
    ACTIVE_CYCLE_STATUSES.includes(l.status as ActiveCycleStatus),
  );
  const buyBaseLots = position.lots.filter((l) => l.status === 'OPEN' || l.status === 'BUYING');
  const openLots = position.lots.filter((l) => l.status === 'OPEN');

  // 1) 1차는 수동 진입
  if (activeLots.length === 0) {
    return orders;
  }

  // 2) 추가매수: 가장 높은 차수 기준으로만 1회
  const top = highestLot(buyBaseLots);
  const hasPendingBuy = position.lots.some((l) => l.status === 'BUYING');
  if (top && !hasPendingBuy) {
    if (top.nth < cfg.maxStages) {
      const nextRule = findBuyRule(cfg.buyRules, top.nth + 1);
      if (nextRule?.triggerDropPct !== null && nextRule !== null) {
        const trigger = top.buyPrice * (1 - nextRule.triggerDropPct);
        if (price <= trigger) {
          const amount = nextRule.amountKrw;
          const qty = qtyForPrice(amount, price);
          if (qty > 0) {
            orders.push({ kind: 'BUY', pdno: cfg.pdno, nth: top.nth + 1, price, qty });
          }
        }
      }
    }
  }

  // 3) 차수별 익절
  for (const lot of openLots) {
    const sellRule = findSellRule(cfg.sellRules, lot.nth);
    if (!sellRule) continue;
    const sellTrigger = lot.buyPrice * (1 + sellRule.targetProfitPct);
    if (price >= sellTrigger) {
      orders.push({ kind: 'SELL', pdno: cfg.pdno, nth: lot.nth, price, qty: lot.qty });
    }
  }

  return orders;
}
