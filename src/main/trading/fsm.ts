import { ACTIVE_CYCLE_STATUSES, type ActiveCycleStatus } from '@shared/trading/next-nth';
import { z } from 'zod';

export const TradingConfigSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/, '종목코드 6자리'),
  totalAmountKrw: z.number().int().positive(),
  maxStages: z.number().int().min(1).max(20),
  /** 직전 차수 대비 추가매수 하락률 (예: 0.03 = 3%). */
  dropPct: z.number().positive().max(0.5),
  /** 차수별 매입가 대비 익절률 (예: 0.05 = 5%). */
  profitPct: z.number().positive().max(0.5),
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

function amountPerStage(cfg: TradingConfig): number {
  return Math.floor(cfg.totalAmountKrw / cfg.maxStages);
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

/**
 * 주어진 현재가, 포지션 스냅샷, 설정을 바탕으로 생성해야 할 주문 목록을 반환.
 *
 * 규칙:
 * 1) 포지션 전무 → 1차 매수 (시드)
 * 2) 직전 차수 매수가 × (1-dropPct) 이하로 하락 → 다음 차수 매수
 *    (단, 다음 차수 ≤ maxStages, qty > 0)
 * 3) OPEN 상태 각 차수 매입가 × (1+profitPct) 이상 상승 → 해당 차수 매도
 * 4) BUYING/SELLING 상태는 재평가하지 않음 (중복 주문 방지)
 * 5) dropPct/profitPct 둘 다 동시 성립 가능 — 매수/매도 모두 emit
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

  // 1) 시드 매수 — active cycle이 없을 때만
  if (activeLots.length === 0) {
    const amount = amountPerStage(cfg);
    const qty = qtyForPrice(amount, price);
    if (qty > 0) {
      orders.push({ kind: 'BUY', pdno: cfg.pdno, nth: 1, price, qty });
    }
    return orders;
  }

  // 2) 추가매수: 가장 높은 차수 기준으로만 1회
  const top = highestLot(buyBaseLots);
  const hasPendingBuy = position.lots.some((l) => l.status === 'BUYING');
  if (top && !hasPendingBuy) {
    if (top.nth < cfg.maxStages) {
      const trigger = top.buyPrice * (1 - cfg.dropPct);
      if (price <= trigger) {
        const amount = amountPerStage(cfg);
        const qty = qtyForPrice(amount, price);
        if (qty > 0) {
          orders.push({ kind: 'BUY', pdno: cfg.pdno, nth: top.nth + 1, price, qty });
        }
      }
    }
  }

  // 3) 차수별 익절
  for (const lot of openLots) {
    const sellTrigger = lot.buyPrice * (1 + cfg.profitPct);
    if (price >= sellTrigger) {
      orders.push({ kind: 'SELL', pdno: cfg.pdno, nth: lot.nth, price, qty: lot.qty });
    }
  }

  return orders;
}
