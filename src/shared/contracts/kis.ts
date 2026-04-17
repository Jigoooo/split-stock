import { z } from 'zod';

/**
 * KIS OAuth 토큰 발급 응답.
 * POST /oauth2/tokenP
 */
export const KisTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  access_token_token_expired: z.string().optional(),
  token_type: z.string().default('Bearer'),
  expires_in: z.number().int().positive(),
});
export type KisTokenResponse = z.infer<typeof KisTokenResponseSchema>;

/**
 * 공통 응답 헤더/꼬리.
 */
export const KisCommonHeaderSchema = z.object({
  rt_cd: z.string(),
  msg_cd: z.string(),
  msg1: z.string(),
});
export type KisCommonHeader = z.infer<typeof KisCommonHeaderSchema>;

/**
 * 국내주식 잔고조회 — output1(보유종목).
 * GET /uapi/domestic-stock/v1/trading/inquire-balance
 * tr_id: TTTC8434R(실전) / VTTC8434R(모의)
 */
export const KisHoldingSchema = z.object({
  pdno: z.string(), // 종목코드
  prdt_name: z.string(), // 종목명
  hldg_qty: z.string(), // 보유수량 (문자 숫자)
  ord_psbl_qty: z.string().optional(), // 주문가능수량
  pchs_avg_pric: z.string(), // 매입평균가
  pchs_amt: z.string().optional(), // 매입금액
  prpr: z.string(), // 현재가
  evlu_amt: z.string(), // 평가금액
  evlu_pfls_amt: z.string(), // 평가손익
  evlu_pfls_rt: z.string(), // 평가손익률
});
export type KisHolding = z.infer<typeof KisHoldingSchema>;

export const KisBalanceResponseSchema = z.object({
  rt_cd: z.string(),
  msg_cd: z.string(),
  msg1: z.string(),
  output1: z.array(KisHoldingSchema),
  output2: z
    .array(
      z.object({
        dnca_tot_amt: z.string(), // 예수금 총액
        prvs_rcdl_excc_amt: z.string().optional(),
        tot_evlu_amt: z.string().optional(), // 총평가금액
        nass_amt: z.string().optional(), // 순자산금액
      }),
    )
    .default([]),
});
export type KisBalanceResponse = z.infer<typeof KisBalanceResponseSchema>;

/**
 * 국내주식 현재가 시세.
 * GET /uapi/domestic-stock/v1/quotations/inquire-price
 */
export const KisPriceResponseSchema = z.object({
  rt_cd: z.string(),
  msg_cd: z.string(),
  msg1: z.string(),
  output: z.object({
    stck_prpr: z.string(), // 현재가
    prdy_vrss: z.string(), // 전일대비
    prdy_ctrt: z.string(), // 전일대비율
    acml_vol: z.string(), // 누적거래량
    acml_tr_pbmn: z.string().optional(), // 누적거래대금
  }),
});
export type KisPriceResponse = z.infer<typeof KisPriceResponseSchema>;

/**
 * 국내주식 주문 요청.
 * POST /uapi/domestic-stock/v1/trading/order-cash
 * tr_id: TTTC0012U(실전 매수) / TTTC0011U(실전 매도) / VTTC0012U(모의 매수) / VTTC0011U(모의 매도)
 */
export const KisOrderSideSchema = z.enum(['BUY', 'SELL']);
export type KisOrderSide = z.infer<typeof KisOrderSideSchema>;

export const KisOrderDivisionSchema = z.enum(['LIMIT', 'MARKET']);
export type KisOrderDivision = z.infer<typeof KisOrderDivisionSchema>;

export const KisOrderRequestSchema = z.object({
  side: KisOrderSideSchema,
  pdno: z.string().regex(/^\d{6}$/, '종목코드 6자리'),
  qty: z.number().int().positive(),
  price: z.number().int().nonnegative(), // 시장가는 0
  division: KisOrderDivisionSchema,
});
export type KisOrderRequest = z.infer<typeof KisOrderRequestSchema>;

export const KisOrderResponseSchema = z.object({
  rt_cd: z.string(),
  msg_cd: z.string(),
  msg1: z.string(),
  output: z.object({
    KRX_FWDG_ORD_ORGNO: z.string().optional(), // 주문조직
    ODNO: z.string(), // 주문번호
    ORD_TMD: z.string(), // 주문시각
  }),
});
export type KisOrderResponse = z.infer<typeof KisOrderResponseSchema>;

/**
 * KIS API 에러를 neverthrow Result로 감싸기 위한 에러 모델.
 */
export type KisErrorKind =
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'VALIDATION'
  | 'API_BUSINESS'
  | 'UNKNOWN';

export type KisError = {
  kind: KisErrorKind;
  msg: string;
  rt_cd?: string;
  msg_cd?: string;
  cause?: unknown;
};
