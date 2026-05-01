import { z } from 'zod';

export const TradingAssetClassSchema = z.enum(['DOMESTIC_STOCK', 'CRYPTO']);
export type TradingAssetClass = z.infer<typeof TradingAssetClassSchema>;

export const CryptoExchangeIdSchema = z.enum(['UPBIT']);
export type CryptoExchangeId = z.infer<typeof CryptoExchangeIdSchema>;

export const CryptoMarketCodeSchema = z
  .string()
  .regex(/^(KRW|BTC|USDT)-[A-Z0-9]{2,20}$/, 'Upbit market code');
export type CryptoMarketCode = z.infer<typeof CryptoMarketCodeSchema>;

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'decimal string');
export type DecimalString = z.infer<typeof DecimalStringSchema>;

export const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => Number(value) > 0,
  'positive decimal string',
);

export const UpbitOrderSideSchema = z.enum(['bid', 'ask']);
export type UpbitOrderSide = z.infer<typeof UpbitOrderSideSchema>;

export const UpbitOrderTypeSchema = z.enum(['limit', 'price', 'market', 'best']);
export type UpbitOrderType = z.infer<typeof UpbitOrderTypeSchema>;

export const UpbitTimeInForceSchema = z.enum(['ioc', 'fok', 'post_only']);
export type UpbitTimeInForce = z.infer<typeof UpbitTimeInForceSchema>;

export const UpbitSmpTypeSchema = z.enum(['reduce', 'cancel_maker', 'cancel_taker']);
export type UpbitSmpType = z.infer<typeof UpbitSmpTypeSchema>;

export const UpbitOrderStateSchema = z.enum(['wait', 'watch', 'done', 'cancel']);
export type UpbitOrderState = z.infer<typeof UpbitOrderStateSchema>;

export const CryptoOrderIntentSchema = z
  .object({
    market: CryptoMarketCodeSchema,
    side: UpbitOrderSideSchema,
    ordType: UpbitOrderTypeSchema,
    price: PositiveDecimalStringSchema.optional(),
    volume: PositiveDecimalStringSchema.optional(),
    timeInForce: UpbitTimeInForceSchema.optional(),
    smpType: UpbitSmpTypeSchema.optional(),
    identifier: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((order, ctx) => {
    if (order.timeInForce === 'post_only' && order.smpType !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['smpType'],
        message: 'post_only cannot be used with smp_type',
      });
    }

    if (order.ordType === 'limit') {
      if (!order.price) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price required' });
      }
      if (!order.volume) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['volume'], message: 'volume required' });
      }
      return;
    }

    if (order.ordType === 'price') {
      if (order.side !== 'bid') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['side'],
          message: 'price order must be bid',
        });
      }
      if (!order.price) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price required' });
      }
      if (order.volume !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['volume'],
          message: 'volume must be omitted',
        });
      }
      return;
    }

    if (order.ordType === 'market') {
      if (order.side !== 'ask') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['side'],
          message: 'market order must be ask',
        });
      }
      if (!order.volume) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['volume'], message: 'volume required' });
      }
      if (order.price !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: 'price must be omitted',
        });
      }
      return;
    }

    if (!order.timeInForce || order.timeInForce === 'post_only') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeInForce'],
        message: 'best order requires ioc or fok',
      });
    }
    if (order.side === 'bid') {
      if (!order.price) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price required' });
      }
      if (order.volume !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['volume'],
          message: 'volume must be omitted',
        });
      }
    } else {
      if (!order.volume) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['volume'], message: 'volume required' });
      }
      if (order.price !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price'],
          message: 'price must be omitted',
        });
      }
    }
  });
export type CryptoOrderIntent = z.infer<typeof CryptoOrderIntentSchema>;

export const CryptoExchangeErrorKindSchema = z.enum([
  'NETWORK',
  'RATE_LIMITED',
  'RATE_LIMIT_PENALTY',
  'AUTH_FAILED',
  'PERMISSION_DENIED',
  'VALIDATION',
  'BUSINESS',
  'NOT_FOUND',
  'UNKNOWN',
]);
export type CryptoExchangeErrorKind = z.infer<typeof CryptoExchangeErrorKindSchema>;

export interface CryptoExchangeError {
  exchangeId: CryptoExchangeId;
  kind: CryptoExchangeErrorKind;
  message: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  raw?: unknown;
}

export interface CryptoMarketSummary {
  exchange: CryptoExchangeId;
  market: CryptoMarketCode;
  koreanName: string;
  englishName: string;
  quoteCurrency: string;
  baseCurrency: string;
  marketWarning: 'NONE' | 'CAUTION' | string;
}

export interface CryptoTicker {
  market: CryptoMarketCode;
  tradePrice: DecimalString;
  signedChangePrice: DecimalString;
  signedChangeRate: DecimalString;
  accTradePrice24h: DecimalString;
  accTradeVolume24h: DecimalString;
  timestamp: number;
}

export interface CryptoOrderbookLevel {
  askPrice: DecimalString;
  askSize: DecimalString;
  bidPrice: DecimalString;
  bidSize: DecimalString;
}

export interface CryptoOrderbook {
  market: CryptoMarketCode;
  timestamp: number;
  totalAskSize: DecimalString;
  totalBidSize: DecimalString;
  levels: CryptoOrderbookLevel[];
}

export interface CryptoBalance {
  currency: string;
  balance: DecimalString;
  locked: DecimalString;
  avgBuyPrice: DecimalString;
  unitCurrency: string;
}
