import type { Balance, Holding } from '@shared/contracts';

/**
 * Kiwoom kt00018 (계좌평가잔고내역) wire shape.
 *
 * 검증 출처: KiwoomRestApi.Net `KiwoomAccountGetEvaluationBalances` +
 * `KiwoomAccountGetEvaluationBalanceItem`. 모든 숫자 필드는 string 으로 응답
 * (Kiwoom 관행) — adapter 가 parseFloat 으로 변환.
 *
 * NOTE: kt00018 은 deposit/d2Deposit 을 제공하지 않음 — Stage 6.5 라이브
 * 검증 후 kt00001(예수금상세현황) 호출 추가 필요. 현재는 0 placeholder.
 */
export interface KiwoomBalanceItemWire {
  stk_cd?: string;
  stk_nm?: string;
  rmnd_qty?: string;
  pur_pric?: string;
  cur_prc?: string;
  evltv_prft?: string;
  prft_rt?: string;
  /** 평가금액 — kt00018 응답에 일부 키 변형 있을 수 있음. */
  evlt_amt?: string;
}

export interface KiwoomBalanceWire {
  return_code?: number | string;
  return_msg?: string;
  /** 추정예탁자산 (≈ estimatedAsset). */
  prsm_dpst_aset_amt?: string;
  /** 총평가금액. */
  tot_evlt_amt?: string;
  /** 총매입금액 — UI 사용처 없으나 디버깅용. */
  tot_pur_amt?: string;
  /** 보유종목 리스트. */
  acnt_evlt_remn_indv_tot?: KiwoomBalanceItemWire[];
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  // Kiwoom 응답에 음수는 '-1234' 또는 '+1234' prefix 포함 가능
  const n = Number(s.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
}

export function toKiwoomHolding(item: KiwoomBalanceItemWire): Holding {
  const qty = parseNum(item.rmnd_qty);
  const avgPrice = parseNum(item.pur_pric);
  const currentPrice = parseNum(item.cur_prc);
  const pnlAmount = parseNum(item.evltv_prft);
  const evalAmount = parseNum(item.evlt_amt) || qty * currentPrice;
  return {
    symbol: item.stk_cd ?? '',
    name: item.stk_nm ?? '',
    qty,
    avgPrice,
    currentPrice,
    evalAmount,
    pnlAmount,
    pnlRate: parseNum(item.prft_rt),
  };
}

/**
 * Kiwoom kt00018 wire → 도메인 Balance.
 *
 * deposit/d2Deposit 은 0 placeholder — Stage 6.5 후 kt00001 (예수금상세현황)
 * 추가 호출로 보강 필요.
 */
export function toKiwoomBalance(wire: KiwoomBalanceWire): Balance {
  const positions = (wire.acnt_evlt_remn_indv_tot ?? []).map(toKiwoomHolding);
  const totalEval = parseNum(wire.tot_evlt_amt);
  const estimatedAsset = parseNum(wire.prsm_dpst_aset_amt) || totalEval;
  return {
    positions,
    deposit: 0,
    d2Deposit: 0,
    totalEval,
    estimatedAsset,
  };
}
