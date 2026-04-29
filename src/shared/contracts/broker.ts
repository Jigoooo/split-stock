import { z } from 'zod';
import { AppEnvSchema } from './app';

/**
 * Broker(증권사) 식별자.
 * 현재 KIS만 라이브, Kiwoom은 Stage 6.5 이후 라이브.
 */
export const BrokerIdSchema = z.enum(['KIS', 'KIWOOM']);
export type BrokerId = z.infer<typeof BrokerIdSchema>;

/**
 * 종목코드. KRX 6자리 숫자가 기본. 향후 NXT/SOR 라우팅 시 prefix 정책 별도 PR.
 */
export const StockSymbolSchema = z.string().regex(/^\d{6}$/, '종목코드 6자리');
export type StockSymbol = z.infer<typeof StockSymbolSchema>;

/**
 * 원(KRW). 정수.
 * 시장가 주문에서는 0 허용.
 */
export const MoneySchema = z.number().int();
export type Money = z.infer<typeof MoneySchema>;

/** 주문 방향. */
export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

/** 주문 유형. */
export const OrderKindSchema = z.enum(['LIMIT', 'MARKET']);
export type OrderKind = z.infer<typeof OrderKindSchema>;

/** 주문 상태. */
export const OrderStatusSchema = z.enum(['PENDING', 'FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** 실시간 구독 종류. */
export const RealtimeKindSchema = z.enum(['TICK', 'ORDERBOOK', 'EXEC_NOTICE']);
export type RealtimeKind = z.infer<typeof RealtimeKindSchema>;

/**
 * 주문 의도 — broker-agnostic.
 * adapter가 broker별 wire-format(KIS pdno/ord_dvsn, Kiwoom stk_cd/trde_tp)으로 변환.
 */
export const OrderIntentSchema = z.object({
  side: OrderSideSchema,
  symbol: StockSymbolSchema,
  qty: z.number().int().positive(),
  price: MoneySchema.nonnegative(), // MARKET이면 0
  kind: OrderKindSchema,
  /** idempotency 키 — adapter가 지원하면 사용. */
  clientOrderId: z.string().optional(),
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

/**
 * 주문 정정/취소 의도.
 */
export const OrderAmendIntentSchema = z.object({
  brokerOrderId: z.string().min(1),
  brokerOrgNo: z.string().optional(),
  qty: z.number().int().positive().optional(),
  price: MoneySchema.nonnegative().optional(),
  kind: OrderKindSchema.optional(),
  /** 전량 취소 (KIS qtyAllOrder, Kiwoom cncl_qty='0'). */
  qtyAllOrder: z.boolean().optional(),
  /**
   * 정정/취소 대상 종목 코드. KIS 는 무시(원주문 식별자만으로 충분), Kiwoom 은
   * kt10002/kt10003 body 의 stk_cd 필수 필드로 사용.
   */
  symbol: StockSymbolSchema.optional(),
});
export type OrderAmendIntent = z.infer<typeof OrderAmendIntentSchema>;

/**
 * 주문 접수 응답 — broker별 ODNO/주문번호를 정규화.
 */
export const OrderAckSchema = z.object({
  brokerOrderId: z.string().min(1),
  brokerOrgNo: z.string().optional(),
  /** broker별 표기 다름. KIS=HHMMSS, Kiwoom=ISO 등 — adapter가 정규화 시도. */
  acceptedAt: z.string().optional(),
});
export type OrderAck = z.infer<typeof OrderAckSchema>;

/**
 * 보유 종목.
 * KIS의 pdno/hldg_qty/prpr 등을 정규화.
 */
export const HoldingSchema = z.object({
  symbol: StockSymbolSchema,
  name: z.string(),
  qty: z.number().int().nonnegative(),
  avgPrice: MoneySchema.nonnegative(),
  currentPrice: MoneySchema.nonnegative(),
  evalAmount: MoneySchema,
  pnlAmount: MoneySchema,
  pnlRate: z.number(), // %
});
export type Holding = z.infer<typeof HoldingSchema>;

/**
 * 잔고 스냅샷.
 */
export const BalanceSchema = z.object({
  positions: z.array(HoldingSchema),
  deposit: MoneySchema.nonnegative(), // 예수금 총액
  d2Deposit: MoneySchema.nonnegative(), // D+2 예수금
  totalEval: MoneySchema, // 총평가금액
  estimatedAsset: MoneySchema, // 순자산금액
});
export type Balance = z.infer<typeof BalanceSchema>;

/**
 * 현재가 시세.
 */
export const QuoteSchema = z.object({
  symbol: StockSymbolSchema,
  price: MoneySchema.nonnegative(),
  dayChange: MoneySchema,
  dayChangeRate: z.number(),
  accumVolume: z.number().int().nonnegative(),
  open: MoneySchema.nonnegative(),
  high: MoneySchema.nonnegative(),
  low: MoneySchema.nonnegative(),
  upperLimit: MoneySchema.nonnegative(),
  lowerLimit: MoneySchema.nonnegative(),
  prevClose: MoneySchema.nonnegative(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/**
 * 호가 1단계.
 */
export const OrderbookLevelSchema = z.object({
  price: MoneySchema.nonnegative(),
  qty: z.number().int().nonnegative(),
});
export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;

/**
 * 호가창 스냅샷 (10단계).
 */
export const OrderbookSnapshotSchema = z.object({
  symbol: StockSymbolSchema,
  /** 시각 (HHMMSS 또는 ISO). adapter가 정규화. */
  time: z.string(),
  /** 매도 호가 (낮은 가격 우선). */
  asks: z.array(OrderbookLevelSchema),
  /** 매수 호가 (높은 가격 우선). */
  bids: z.array(OrderbookLevelSchema),
  totalAskQty: z.number().int().nonnegative(),
  totalBidQty: z.number().int().nonnegative(),
  /** 예상 체결가 (장 시작/마감 동시호가). */
  expectedPrice: MoneySchema.nonnegative(),
  expectedQty: z.number().int().nonnegative(),
});
export type OrderbookSnapshot = z.infer<typeof OrderbookSnapshotSchema>;

/**
 * 일봉/주봉/월봉 OHLCV.
 */
export const CandleSchema = z.object({
  date: z.string(), // YYYYMMDD
  open: MoneySchema.nonnegative(),
  high: MoneySchema.nonnegative(),
  low: MoneySchema.nonnegative(),
  close: MoneySchema.nonnegative(),
  volume: z.number().int().nonnegative(),
});
export type Candle = z.infer<typeof CandleSchema>;

/**
 * 일별 주문/체결 항목.
 * KIS의 inquireDailyCcld 응답을 정규화.
 */
export const DailyExecutionSchema = z.object({
  brokerOrderId: z.string(),
  /** broker별 원주문 조직번호. KIS 취소에는 KRX_FWDG_ORD_ORGNO/ord_orgno가 필요하다. */
  brokerOrgNo: z.string().optional(),
  symbol: StockSymbolSchema,
  name: z.string(),
  side: OrderSideSchema,
  orderQty: z.number().int().nonnegative(),
  orderPrice: MoneySchema.nonnegative(),
  orderedAt: z.string(),
  totalFilledQty: z.number().int().nonnegative(),
  remainingQty: z.number().int().nonnegative(),
  avgFillPrice: MoneySchema.nonnegative(),
  cancelled: z.boolean(),
  rejectedQty: z.number().int().nonnegative(),
});
export type DailyExecution = z.infer<typeof DailyExecutionSchema>;

/**
 * 실시간 이벤트 (broker-agnostic).
 * KIS의 H0STCNT0/H0STASP0/H0STCNI0과 Kiwoom의 0B/0D/00을 같은 형태로 흡수.
 */
export const PriceTickEventSchema = z.object({
  symbol: StockSymbolSchema,
  price: MoneySchema.nonnegative(),
  volume: z.number().int().nonnegative(),
  /** 체결 시각 (HHMMSS 또는 ISO). */
  tradedAt: z.string(),
  /** 시퀀스 (조정용). */
  seq: z.number().int().nonnegative(),
});
export type PriceTickEvent = z.infer<typeof PriceTickEventSchema>;

export const OrderbookEventSchema = z.object({
  snapshot: OrderbookSnapshotSchema,
  seq: z.number().int().nonnegative(),
});
export type OrderbookEvent = z.infer<typeof OrderbookEventSchema>;

export const ExecNoticeEventSchema = z.object({
  brokerOrderId: z.string(),
  symbol: StockSymbolSchema,
  filledQty: z.number().int().nonnegative(),
  price: MoneySchema.nonnegative(),
  at: z.string(),
});
export type ExecNoticeEvent = z.infer<typeof ExecNoticeEventSchema>;

export const RealtimeEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TICK'), data: PriceTickEventSchema }),
  z.object({ kind: z.literal('ORDERBOOK'), data: OrderbookEventSchema }),
  z.object({ kind: z.literal('EXEC_NOTICE'), data: ExecNoticeEventSchema }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

/**
 * Broker 에러 분류 — broker-agnostic.
 */
export const BrokerErrorKindSchema = z.enum([
  'NETWORK',
  'RATE_LIMITED',
  'AUTH_FAILED',
  'VALIDATION',
  'BUSINESS', // broker가 요청을 받았으나 비즈니스 룰로 거부
  'NOT_IMPLEMENTED', // adapter가 해당 기능 미구현 (Kiwoom stub 등)
  'UNKNOWN',
]);
export type BrokerErrorKind = z.infer<typeof BrokerErrorKindSchema>;

/**
 * Broker 에러 — neverthrow Result로 감싸기 위한 에러 모델.
 *
 * cluefin의 KisXxxError/KiwoomXxxError 같은 클래스 폭증 대신
 * brokerId 필드로 단일 객체에 흡수.
 */
export interface BrokerError {
  brokerId: BrokerId;
  kind: BrokerErrorKind;
  msg: string;
  /** broker별 raw 코드 (KIS rt_cd/msg_cd, Kiwoom return_code 등). */
  raw?: { code?: string; subCode?: string };
  cause?: unknown;
}

/**
 * Broker 에러 생성 헬퍼.
 *
 * exactOptionalPropertyTypes 호환을 위해 undefined 값은 키 자체를 생략한다.
 */
export function makeBrokerError(opts: {
  brokerId: BrokerId;
  kind: BrokerErrorKind;
  msg: string;
  raw?: BrokerError['raw'];
  cause?: unknown;
}): BrokerError {
  const err: BrokerError = {
    brokerId: opts.brokerId,
    kind: opts.kind,
    msg: opts.msg,
  };
  if (opts.raw !== undefined) err.raw = opts.raw;
  if (opts.cause !== undefined) err.cause = opts.cause;
  return err;
}

/**
 * Active broker session — credentials-repo 와 연동 (Stage 5).
 *
 * 현재는 BrokerId만 사용. accountId+env 와 함께 broker 식별에 사용.
 */
export const BrokerSessionSchema = z.object({
  brokerId: BrokerIdSchema,
  env: AppEnvSchema,
  accountId: z.number().int().positive(),
});
export type BrokerSession = z.infer<typeof BrokerSessionSchema>;
