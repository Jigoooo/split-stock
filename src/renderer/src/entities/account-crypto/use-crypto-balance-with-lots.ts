import { trpc } from '@renderer/shared/api/trpc';
import type { CryptoLot } from '@shared/contracts';

/**
 * 코인 차수별 잔고 hook — 국내주식의 useBalanceWithLots와 시그니처를 맞춰
 * 메인 화면에서 차수 grid를 표시할 수 있게 한다. (RALPLAN P6 A0)
 *
 * 단일 market에 대한 lot 리스트와 summary를 반환. 다중 market 합산은
 * 후속(A6 trade-cycle) 작업에서 별도 endpoint로 추가.
 */

export interface CryptoLotEntry {
  /** 차수 (sequence). 국내주식의 nth와 동일 의미. */
  nth: number;
  /** 평단 (KRW) */
  buyPrice: number;
  /** 보유 수량 (코인) */
  qty: number;
  /** 매입금액 (KRW) — qty * buyPrice 또는 allocatedKrw */
  amountKrw: number;
  status: CryptoLot['status'];
  boughtAt: number;
  closedAt?: number | null;
  realizedPnl: number;
}

export interface CryptoBalanceWithLotsPosition {
  market: string;
  baseCurrency: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

export interface CryptoBalanceWithLotsSummary {
  /** KRW 주문가능 잔고 */
  deposit: number;
  /** 코인 평가금액 합 */
  totalEval: number;
  /** 차수별 매입금액 합 (open lots 기준) */
  totalBuyAmount: number;
  /** 평가 - 매입 */
  totalPnlAmount: number;
  /** pnl / buyAmount */
  totalPnlRate: number;
}

export interface UseCryptoBalanceWithLotsResult {
  position: CryptoBalanceWithLotsPosition | null;
  lots: CryptoLotEntry[];
  summary: CryptoBalanceWithLotsSummary;
  isPending: boolean;
  error: { message: string } | null;
}

const EMPTY_SUMMARY: CryptoBalanceWithLotsSummary = {
  deposit: 0,
  totalEval: 0,
  totalBuyAmount: 0,
  totalPnlAmount: 0,
  totalPnlRate: 0,
};

const num = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function useCryptoBalanceWithLots(
  accountId: number,
  market: string,
): UseCryptoBalanceWithLotsResult {
  const enabled = accountId > 0 && market.length > 0;
  const balancesQuery = trpc.crypto.getBalances.useQuery({ accountId }, { enabled });
  const statusQuery = trpc.crypto.getAutoStatus.useQuery({ accountId, market }, { enabled });
  const tickerQuery = trpc.crypto.getTicker.useQuery({ market }, { enabled });

  const [quoteCurrency = 'KRW', baseCurrency = ''] = market.split('-');
  const balances = balancesQuery.data?.balances ?? [];
  const quoteBalance = balances.find((b) => b.currency === quoteCurrency);
  const baseBalance = balances.find((b) => b.currency === baseCurrency);

  const liveLots = statusQuery.data?.liveLots ?? [];
  const currentPrice = num(tickerQuery.data?.tradePrice);

  const lots: CryptoLotEntry[] = liveLots.map((lot) => ({
    nth: lot.sequence,
    buyPrice: num(lot.avgEntryKrw),
    qty: num(lot.quantity),
    amountKrw: num(lot.allocatedKrw),
    status: lot.status,
    boughtAt: lot.openedAt,
    closedAt: lot.closedAt,
    realizedPnl: num(lot.realizedPnl),
  }));

  const totalQty = lots.reduce((sum, lot) => sum + lot.qty, 0);
  const totalBuyAmount = lots.reduce((sum, lot) => sum + lot.amountKrw, 0);
  const totalEval = totalQty * currentPrice;
  const totalPnlAmount = totalEval - totalBuyAmount;
  const totalPnlRate = totalBuyAmount > 0 ? totalPnlAmount / totalBuyAmount : 0;
  const avgPrice = totalQty > 0 ? totalBuyAmount / totalQty : 0;

  const position: CryptoBalanceWithLotsPosition | null =
    totalQty > 0 || baseBalance
      ? {
          market,
          baseCurrency,
          qty: totalQty || num(baseBalance?.balance),
          avgPrice: avgPrice || num(baseBalance?.avgBuyPrice),
          currentPrice,
          evalAmount: totalEval,
          pnlAmount: totalPnlAmount,
          pnlRate: totalPnlRate,
        }
      : null;

  const summary: CryptoBalanceWithLotsSummary = {
    deposit: num(quoteBalance?.balance),
    totalEval,
    totalBuyAmount,
    totalPnlAmount,
    totalPnlRate,
  };

  return {
    position,
    lots,
    summary: enabled ? summary : EMPTY_SUMMARY,
    isPending: balancesQuery.isPending || statusQuery.isPending,
    error: balancesQuery.error ?? statusQuery.error ?? tickerQuery.error ?? null,
  };
}
