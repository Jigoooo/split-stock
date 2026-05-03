import { trpc } from '@renderer/shared/api/trpc';
import type { CryptoLot } from '@shared/contracts';

/**
 * 코인 매매 사이클(닫힌 차수) hook — 매직스플릿 차수 매수→매도 완결 분석.
 * cryptoAutoLots.status='closed' 그룹핑. (RALPLAN P6 A6)
 */

export interface CryptoTradeCycle {
  /** lot id (안정 키) */
  id: number;
  /** 차수 (sequence) */
  nth: number;
  /** 평단 매수가 (KRW) */
  buyPrice: number;
  /** 매도 시 평균 청산가 — 미가용 시 null (lot에 sellPrice 미저장) */
  qty: number;
  /** 차수에 배정된 KRW (cost basis) */
  amountKrw: number;
  /** 실현 손익 (KRW). 양수=익절, 음수=손절 */
  realizedPnl: number;
  /** 손익률 = realizedPnl / amountKrw */
  pnlRate: number;
  openedAt: number;
  closedAt: number | null;
  source: CryptoLot['source'];
}

export interface UseCryptoTradeCyclesResult {
  cycles: CryptoTradeCycle[];
  isPending: boolean;
  error: { message: string } | null;
}

const num = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function useCryptoTradeCycles(
  accountId: number,
  market: string,
  limit = 100,
): UseCryptoTradeCyclesResult {
  const enabled = accountId > 0 && market.length > 0;
  const query = trpc.crypto.listClosedLots.useQuery(
    { accountId, market, limit },
    { enabled, staleTime: 5_000, refetchInterval: enabled ? 30_000 : false },
  );

  const cycles: CryptoTradeCycle[] = (query.data?.lots ?? []).map((lot) => {
    const amount = num(lot.allocatedKrw);
    const pnl = num(lot.realizedPnl);
    return {
      id: lot.id,
      nth: lot.sequence,
      buyPrice: num(lot.avgEntryKrw),
      qty: num(lot.quantity),
      amountKrw: amount,
      realizedPnl: pnl,
      pnlRate: amount > 0 ? pnl / amount : 0,
      openedAt: lot.openedAt,
      closedAt: lot.closedAt,
      source: lot.source,
    };
  });

  return {
    cycles,
    isPending: query.isPending,
    error: query.error ?? null,
  };
}
