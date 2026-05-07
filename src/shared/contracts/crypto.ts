import { z } from 'zod';

export const TradingAssetClassSchema = z.enum(['DOMESTIC_STOCK', 'CRYPTO']);
export type TradingAssetClass = z.infer<typeof TradingAssetClassSchema>;

/**
 * 코인 거래소 식별자 — 컴파일 타임 상수.
 * 새 거래소 추가 시 EXCHANGES 와 CryptoExchangeIdSchema 양쪽 갱신.
 */
export const EXCHANGES = {
  UPBIT: 'UPBIT',
} as const;
export type Exchange = (typeof EXCHANGES)[keyof typeof EXCHANGES];

export const CryptoExchangeIdSchema = z.enum([EXCHANGES.UPBIT]);
export type CryptoExchangeId = z.infer<typeof CryptoExchangeIdSchema>;

/** 코인 quote currency — 거래쌍의 결제 통화. */
export const QUOTE_CURRENCIES = {
  KRW: 'KRW',
  BTC: 'BTC',
  USDT: 'USDT',
} as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[keyof typeof QUOTE_CURRENCIES];

/** 기본 quote currency — 한국 기반 사용자 default. */
export const DEFAULT_CRYPTO_QUOTE: QuoteCurrency = QUOTE_CURRENCIES.KRW;

/** 기본 코인 마켓 — settings/main 화면 default. */
export const DEFAULT_CRYPTO_MARKET = `${DEFAULT_CRYPTO_QUOTE}-BTC` as const;

export const CryptoMarketCodeSchema = z
  .string()
  .regex(/^(KRW|BTC|USDT)-[A-Z0-9]{2,20}$/, 'Upbit market code');
export type CryptoMarketCode = z.infer<typeof CryptoMarketCodeSchema>;

export const CryptoKrwMarketCodeSchema = z
  .string()
  .regex(/^KRW-[A-Z0-9]{2,20}$/, 'Upbit KRW market code');
export type CryptoKrwMarketCode = z.infer<typeof CryptoKrwMarketCodeSchema>;

export const CRYPTO_CANDLE_UNITS = [
  '1m',
  '3m',
  '5m',
  '10m',
  '15m',
  '30m',
  '60m',
  '240m',
  'D',
  'W',
  'M',
] as const;
export const CryptoCandleUnitSchema = z.enum(CRYPTO_CANDLE_UNITS);
export type CryptoCandleUnit = z.infer<typeof CryptoCandleUnitSchema>;

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'decimal string');
export type DecimalString = z.infer<typeof DecimalStringSchema>;

export const SignedDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?$/, 'signed decimal string');
export type SignedDecimalString = z.infer<typeof SignedDecimalStringSchema>;

export const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => Number(value) > 0,
  'positive decimal string',
);

export const CryptoAutoModeSchema = z.enum(['disabled', 'dry-run', 'live-small']);
export type CryptoAutoMode = z.infer<typeof CryptoAutoModeSchema>;

export const CryptoAutoLotSourceSchema = z.enum(['dry-run', 'live']);
export type CryptoAutoLotSource = z.infer<typeof CryptoAutoLotSourceSchema>;

export const CryptoAutoIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('noop'),
    market: CryptoKrwMarketCodeSchema,
    reason: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('plan-buy'),
    market: CryptoKrwMarketCodeSchema,
    krwAmount: PositiveDecimalStringSchema,
    limitPrice: PositiveDecimalStringSchema,
  }),
  z.object({
    kind: z.literal('plan-sell'),
    market: CryptoKrwMarketCodeSchema,
    lotId: z.number().int().positive(),
    quantity: PositiveDecimalStringSchema,
    limitPrice: PositiveDecimalStringSchema,
  }),
  z.object({
    kind: z.literal('cancel-stale'),
    market: CryptoKrwMarketCodeSchema,
    orderId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  }),
]);
export type CryptoAutoIntent = z.infer<typeof CryptoAutoIntentSchema>;

export const CryptoAutoGuardConfigSchema = z.object({
  exchange: z.literal('UPBIT').default('UPBIT'),
  accountEnv: z.literal('PROD').default('PROD'),
  mode: CryptoAutoModeSchema.default('disabled'),
  emergencyDisabled: z.boolean().default(true),
  baseOrderKrw: PositiveDecimalStringSchema.default('5000'),
  maxOrderKrw: PositiveDecimalStringSchema.default('5000'),
  maxTotalExposureKrw: PositiveDecimalStringSchema.default('50000'),
  minOrderTotalKrw: PositiveDecimalStringSchema.default('5000'),
  addTriggerPct: PositiveDecimalStringSchema.default('0.03'),
  takeProfitPct: PositiveDecimalStringSchema.default('0.02'),
  maxOpenLots: z.number().int().min(1).max(50).default(3),
  cooldownMs: z.number().int().min(1000).max(86_400_000).default(60_000),
  staleCancelCap: z.number().int().min(0).max(20).default(3),
  requireReadOnlySmoke: z.boolean().default(true),
  requireDryRunHistoryBeforeLive: z.boolean().default(true),
});
export type CryptoAutoGuardConfig = z.infer<typeof CryptoAutoGuardConfigSchema>;

export const MAX_CRYPTO_STRATEGY_STAGES = 50;
const CryptoStrategyStageNthSchema = z.number().int().min(1).max(MAX_CRYPTO_STRATEGY_STAGES);
const CryptoStrategyOrderTypeSchema = z.enum(['LIMIT', 'MARKET']);

export const CryptoStrategyAutoModeSchema = z.enum(['ALL_ON', 'ALL_OFF', 'BUY_ONLY', 'SELL_ONLY']);
export type CryptoStrategyAutoMode = z.infer<typeof CryptoStrategyAutoModeSchema>;

export const CryptoStrategyBuyRuleSchema = z.object({
  nth: CryptoStrategyStageNthSchema,
  triggerDropPct: PositiveDecimalStringSchema.nullable(),
  amountKrw: PositiveDecimalStringSchema,
});
export type CryptoStrategyBuyRule = z.infer<typeof CryptoStrategyBuyRuleSchema>;

export const CryptoStrategySellRuleSchema = z.object({
  nth: CryptoStrategyStageNthSchema,
  targetProfitPct: PositiveDecimalStringSchema,
});
export type CryptoStrategySellRule = z.infer<typeof CryptoStrategySellRuleSchema>;

/**
 * E2-1 코인 수익 부스터 설정.
 * 1차 전량 매도 후 lastFilledPrice * (1 - dropPct) 도달 시 1차 재매수.
 * dropPct 는 DecimalString (crypto schema 컨벤션). '0' 이하면 즉시 트리거 (홀딩 유지 효과).
 * amountKrwOverride 미지정 시 buyRules[0].amountKrw 사용.
 */
export const CryptoProfitBoosterSchema = z.object({
  enabled: z.boolean().default(false),
  /** 재매수 트리거 하락률 (DecimalString, '0.01' = 1%). '0' 이하면 즉시 트리거. */
  dropPct: DecimalStringSchema.default('0'),
  /** 만료 시간 (ms 절대시각). null 이면 만료 없음. */
  expiresAt: z.number().int().nullable().default(null),
});
export type CryptoProfitBoosterConfig = z.infer<typeof CryptoProfitBoosterSchema>;

const CryptoStrategyProfileBaseSchema = z.object({
  version: z.literal(1).default(1),
  market: CryptoKrwMarketCodeSchema,
  maxStages: z.number().int().min(1).max(MAX_CRYPTO_STRATEGY_STAGES),
  buyRules: z.array(CryptoStrategyBuyRuleSchema).min(1).max(MAX_CRYPTO_STRATEGY_STAGES),
  sellRules: z.array(CryptoStrategySellRuleSchema).min(1).max(MAX_CRYPTO_STRATEGY_STAGES),
  autoBuyEnabled: z.boolean().default(false),
  autoBuyOrderType: CryptoStrategyOrderTypeSchema.default('MARKET'),
  autoSellEnabled: z.boolean().default(false),
  autoSellOrderType: CryptoStrategyOrderTypeSchema.default('MARKET'),
  /** E2-1 코인 수익 부스터 — optional 로 기존 저장값과 호환. */
  profitBooster: CryptoProfitBoosterSchema.optional(),
});

export const CryptoStrategyProfileSchema = CryptoStrategyProfileBaseSchema.superRefine(
  (profile, ctx) => {
    if (profile.buyRules.length < profile.maxStages) {
      ctx.addIssue({
        code: 'custom' as const,
        path: ['buyRules'],
        message: 'buyRules는 maxStages 이상 채워야 합니다.',
      });
    }
    if (profile.sellRules.length < profile.maxStages) {
      ctx.addIssue({
        code: 'custom' as const,
        path: ['sellRules'],
        message: 'sellRules는 maxStages 이상 채워야 합니다.',
      });
    }

    for (let index = 0; index < profile.buyRules.length; index += 1) {
      const nth = index + 1;
      const rule = profile.buyRules[index];
      if (!rule || rule.nth !== nth) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['buyRules'],
          message: 'buyRules nth는 1차부터 순서대로 채워야 합니다.',
        });
        break;
      }
      if (nth === 1 && rule.triggerDropPct !== null) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['buyRules', index, 'triggerDropPct'],
          message: '1차 triggerDropPct는 null이어야 합니다.',
        });
      }
      if (nth > 1 && rule.triggerDropPct === null) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['buyRules', index, 'triggerDropPct'],
          message: '2차 이후 triggerDropPct가 필요합니다.',
        });
      }
    }

    for (let index = 0; index < profile.sellRules.length; index += 1) {
      const nth = index + 1;
      const rule = profile.sellRules[index];
      if (!rule || rule.nth !== nth) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['sellRules'],
          message: 'sellRules nth는 1차부터 순서대로 채워야 합니다.',
        });
        break;
      }
    }
  },
);
export type CryptoStrategyProfile = z.infer<typeof CryptoStrategyProfileSchema>;

export function createCryptoStrategyRules(
  maxStages: number = 3,
  opts: {
    amountKrw?: DecimalString;
    dropPct?: DecimalString;
    profitPct?: DecimalString;
  } = {},
): Pick<CryptoStrategyProfile, 'buyRules' | 'sellRules'> {
  const safeMaxStages = Math.max(1, Math.min(MAX_CRYPTO_STRATEGY_STAGES, Math.trunc(maxStages)));
  const amountKrw = opts.amountKrw ?? '5000';
  const dropPct = opts.dropPct ?? '0.03';
  const profitPct = opts.profitPct ?? '0.02';
  return {
    buyRules: Array.from({ length: safeMaxStages }, (_, index) => ({
      nth: index + 1,
      triggerDropPct: index === 0 ? null : dropPct,
      amountKrw,
    })),
    sellRules: Array.from({ length: safeMaxStages }, (_, index) => ({
      nth: index + 1,
      targetProfitPct: profitPct,
    })),
  };
}

export function createDefaultCryptoStrategyProfile(
  market: CryptoKrwMarketCode,
): CryptoStrategyProfile {
  return {
    version: 1,
    market,
    maxStages: 3,
    ...createCryptoStrategyRules(3),
    autoBuyEnabled: false,
    autoBuyOrderType: 'MARKET',
    autoSellEnabled: false,
    autoSellOrderType: 'MARKET',
  };
}

export function deriveCryptoStrategyAutoMode(
  profile: Pick<CryptoStrategyProfile, 'autoBuyEnabled' | 'autoSellEnabled'>,
): CryptoStrategyAutoMode {
  if (profile.autoBuyEnabled && profile.autoSellEnabled) return 'ALL_ON';
  if (!profile.autoBuyEnabled && !profile.autoSellEnabled) return 'ALL_OFF';
  return profile.autoBuyEnabled ? 'BUY_ONLY' : 'SELL_ONLY';
}

export function applyCryptoStrategyAutoMode(
  profile: CryptoStrategyProfile,
  mode: CryptoStrategyAutoMode,
): CryptoStrategyProfile {
  return {
    ...profile,
    autoBuyEnabled: mode !== 'ALL_OFF' && mode !== 'SELL_ONLY',
    autoSellEnabled: mode !== 'ALL_OFF' && mode !== 'BUY_ONLY',
  };
}

export const CryptoAutoWatchStatusSchema = z.enum([
  'WATCHING',
  'PAUSED',
  'EXECUTED',
  'FAILED',
  'CANCELLED',
]);
export type CryptoAutoWatchStatus = z.infer<typeof CryptoAutoWatchStatusSchema>;

export const CryptoAutoWatchEntryConditionSchema = z.object({
  type: z.enum(['immediate', 'price-above', 'price-below']).default('immediate'),
  price: PositiveDecimalStringSchema.nullable().default(null),
});
export type CryptoAutoWatchEntryCondition = z.infer<typeof CryptoAutoWatchEntryConditionSchema>;

export const CryptoAutoWatchListFilterSchema = z
  .object({
    accountId: z.number().int().positive().optional(),
    market: CryptoKrwMarketCodeSchema.optional(),
    status: CryptoAutoWatchStatusSchema.optional(),
    includeCancelled: z.boolean().default(false),
  })
  .optional();
export type CryptoAutoWatchListFilter = z.infer<typeof CryptoAutoWatchListFilterSchema>;

export const CryptoAutoWatchUpsertInputSchema = z.object({
  accountId: z.number().int().positive().optional(),
  id: z.number().int().positive().optional(),
  market: CryptoKrwMarketCodeSchema,
  label: z.string().trim().max(60).optional(),
  status: CryptoAutoWatchStatusSchema.default('PAUSED'),
  entryCondition: CryptoAutoWatchEntryConditionSchema.default({
    type: 'immediate',
    price: null,
  }),
  strategy: CryptoStrategyProfileSchema,
  guard: CryptoAutoGuardConfigSchema.partial().default({}),
});
export type CryptoAutoWatchUpsertInput = z.infer<typeof CryptoAutoWatchUpsertInputSchema>;

export const CryptoAutoWatchActionInputSchema = z.object({
  accountId: z.number().int().positive().optional(),
  ids: z.array(z.number().int().positive()).min(1).max(100),
});
export type CryptoAutoWatchActionInput = z.infer<typeof CryptoAutoWatchActionInputSchema>;

export const CryptoAutoTradeHistoryFilterSchema = z
  .object({
    accountId: z.number().int().positive().optional(),
    market: CryptoKrwMarketCodeSchema.optional(),
    status: z.enum(['all', 'open', 'closed', 'failed']).default('all'),
    limit: z.number().int().min(1).max(200).default(80),
  })
  .optional();
export type CryptoAutoTradeHistoryFilter = z.infer<typeof CryptoAutoTradeHistoryFilterSchema>;

export const CryptoAutoTemplateSchema = z.object({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  name: z.string().trim().min(1).max(60),
  strategy: CryptoStrategyProfileSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type CryptoAutoTemplate = z.infer<typeof CryptoAutoTemplateSchema>;

export const CryptoAutoTemplateUpsertInputSchema = z.object({
  accountId: z.number().int().positive().optional(),
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(60),
  strategy: CryptoStrategyProfileSchema,
});
export type CryptoAutoTemplateUpsertInput = z.infer<typeof CryptoAutoTemplateUpsertInputSchema>;

export interface CryptoLot {
  id: number;
  accountId: number;
  exchange: CryptoExchangeId;
  market: CryptoKrwMarketCode;
  source: CryptoAutoLotSource;
  sequence: number;
  quantity: DecimalString;
  avgEntryKrw: DecimalString;
  allocatedKrw: DecimalString;
  realizedPnl: SignedDecimalString;
  feesPaid: DecimalString;
  status: 'open' | 'reducing' | 'closed';
  openedAt: number;
  closedAt: number | null;
  updatedAt: number;
}

export interface CryptoAutoConfig extends CryptoAutoGuardConfig {
  accountId: number;
  market: CryptoKrwMarketCode;
  lastDryRunAt: number | null;
  lastReadonlySmokeAt: number | null;
  lastLiveActionAt: number | null;
  updatedAt: number;
}

export interface CryptoAutoEvent {
  id: number;
  accountId: number;
  exchange: CryptoExchangeId;
  market: CryptoKrwMarketCode;
  mode: CryptoAutoMode;
  kind: 'dry-run' | 'live-place' | 'live-cancel' | 'blocked' | 'smoke' | 'config' | 'decimal-error';
  action: CryptoAutoIntent['kind'] | 'config' | 'smoke';
  reason: string;
  intent: CryptoAutoIntent | null;
  result: unknown;
  idempotencyKey: string | null;
  createdAt: number;
}

export interface CryptoAutoGateResult {
  ok: boolean;
  blockedReasons: string[];
}

export interface CryptoAutoRunResult {
  accountId: number;
  market: CryptoKrwMarketCode;
  mode: CryptoAutoMode;
  intent: CryptoAutoIntent;
  gate: CryptoAutoGateResult;
  event: CryptoAutoEvent;
  orderUuid?: string;
}

export interface CryptoAutoStatus {
  accountId: number;
  market: CryptoKrwMarketCode;
  config: CryptoAutoConfig;
  openLots: CryptoLot[];
  dryRunLots: CryptoLot[];
  liveLots: CryptoLot[];
  recentEvents: CryptoAutoEvent[];
  gate: CryptoAutoGateResult;
  runtimeRunning: boolean;
}

export interface CryptoAutoWatch {
  id: number;
  accountId: number;
  exchange: CryptoExchangeId;
  market: CryptoKrwMarketCode;
  label: string | null;
  status: CryptoAutoWatchStatus;
  entryCondition: CryptoAutoWatchEntryCondition;
  strategy: CryptoStrategyProfile;
  config: CryptoAutoConfig;
  currentStage: number;
  openOrderCount: number;
  lastDecision: string | null;
  lastDecisionAt: number | null;
  lastActionAt: number | null;
  blockedReasons: string[];
  runtimeRunning: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CryptoAutoWatchActionResult {
  accountId: number;
  ids: number[];
  affected: number;
}

export interface CryptoAutoTradeHistoryItem {
  id: number;
  accountId: number;
  exchange: CryptoExchangeId;
  market: CryptoKrwMarketCode;
  status: 'open' | 'closed' | 'failed' | 'event';
  action: string;
  reason: string;
  mode: CryptoAutoMode;
  createdAt: number;
}

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
        code: 'custom' as const,
        path: ['smpType'],
        message: 'post_only cannot be used with smp_type',
      });
    }

    if (order.ordType === 'limit') {
      if (!order.price) {
        ctx.addIssue({ code: 'custom' as const, path: ['price'], message: 'price required' });
      }
      if (!order.volume) {
        ctx.addIssue({ code: 'custom' as const, path: ['volume'], message: 'volume required' });
      }
      return;
    }

    if (order.ordType === 'price') {
      if (order.side !== 'bid') {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['side'],
          message: 'price order must be bid',
        });
      }
      if (!order.price) {
        ctx.addIssue({ code: 'custom' as const, path: ['price'], message: 'price required' });
      }
      if (order.volume !== undefined) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['volume'],
          message: 'volume must be omitted',
        });
      }
      return;
    }

    if (order.ordType === 'market') {
      if (order.side !== 'ask') {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['side'],
          message: 'market order must be ask',
        });
      }
      if (!order.volume) {
        ctx.addIssue({ code: 'custom' as const, path: ['volume'], message: 'volume required' });
      }
      if (order.price !== undefined) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['price'],
          message: 'price must be omitted',
        });
      }
      return;
    }

    if (!order.timeInForce || order.timeInForce === 'post_only') {
      ctx.addIssue({
        code: 'custom' as const,
        path: ['timeInForce'],
        message: 'best order requires ioc or fok',
      });
    }
    if (order.side === 'bid') {
      if (!order.price) {
        ctx.addIssue({ code: 'custom' as const, path: ['price'], message: 'price required' });
      }
      if (order.volume !== undefined) {
        ctx.addIssue({
          code: 'custom' as const,
          path: ['volume'],
          message: 'volume must be omitted',
        });
      }
    } else {
      if (!order.volume) {
        ctx.addIssue({ code: 'custom' as const, path: ['volume'], message: 'volume required' });
      }
      if (order.price !== undefined) {
        ctx.addIssue({
          code: 'custom' as const,
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
  openingPrice: DecimalString;
  highPrice: DecimalString;
  lowPrice: DecimalString;
  signedChangePrice: DecimalString;
  signedChangeRate: DecimalString;
  accTradePrice24h: DecimalString;
  accTradeVolume24h: DecimalString;
  timestamp: number;
}

export interface CryptoCandle {
  exchange: CryptoExchangeId;
  market: CryptoMarketCode;
  unit: CryptoCandleUnit;
  candleAt: number;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  volume: DecimalString;
  tradePrice: DecimalString;
  raw?: unknown;
}

export interface CryptoOrderbookInstrument {
  exchange: CryptoExchangeId;
  market: CryptoMarketCode;
  quoteCurrency: string;
  tickSize: DecimalString;
  supportedLevels: DecimalString[];
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

export interface CryptoBalanceSummary {
  currency: string;
  unitCurrency: string;
  available: DecimalString;
  locked: DecimalString;
  total: DecimalString;
  avgBuyPrice: DecimalString;
  valuation: DecimalString;
  costBasis: DecimalString;
  profitLoss: SignedDecimalString;
  profitLossRate: SignedDecimalString;
}

export const CryptoTransferDirectionSchema = z.enum(['deposit', 'withdraw']);
export type CryptoTransferDirection = z.infer<typeof CryptoTransferDirectionSchema>;

export const CryptoTransferStatusStateSchema = z.string().trim().min(1);
export type CryptoTransferStatusState = z.infer<typeof CryptoTransferStatusStateSchema>;

export interface CryptoTransferStatus {
  direction: CryptoTransferDirection;
  uuid: string;
  currency: string;
  amount: DecimalString;
  fee: DecimalString;
  state: CryptoTransferStatusState;
  txid: string | null;
  transactionType: string;
  transferType: string;
  netType: string | null;
  createdAt: number;
  doneAt: number | null;
  isCancelable?: boolean | null;
  raw?: unknown;
}

export interface CryptoWalletStatus {
  currency: string;
  netType: string;
  networkName: string;
  walletState: 'working' | 'withdraw_only' | 'deposit_only' | 'paused' | 'unsupported' | string;
  blockElapsedMinutes: number | null;
  blockHeight: number | null;
  blockState: 'normal' | 'delayed' | 'inactive' | string | null;
  blockUpdatedAt: number | null;
  raw?: unknown;
}

export interface CryptoRealtimeTicker extends CryptoTicker {
  exchange: CryptoExchangeId;
  receivedAt: number;
  streamType?: 'SNAPSHOT' | 'REALTIME';
  change?: 'RISE' | 'EVEN' | 'FALL';
}

export interface CryptoRealtimeTrade {
  exchange: CryptoExchangeId;
  market: CryptoMarketCode;
  tradePrice: DecimalString;
  tradeVolume: DecimalString;
  askBid: 'ASK' | 'BID' | string;
  change?: 'RISE' | 'EVEN' | 'FALL';
  sequentialId?: number;
  tradeTimestamp: number;
  timestamp: number;
  receivedAt: number;
  streamType?: 'SNAPSHOT' | 'REALTIME';
}

export interface CryptoRealtimeOrderbook extends CryptoOrderbook {
  exchange: CryptoExchangeId;
  level?: DecimalString;
  receivedAt: number;
  streamType?: 'SNAPSHOT' | 'REALTIME';
}

export interface CryptoRealtimeCandle extends CryptoCandle {
  receivedAt: number;
  streamType?: 'SNAPSHOT' | 'REALTIME';
}

export interface CryptoPrivateOrderEvent {
  exchange: CryptoExchangeId;
  accountId: number;
  market: CryptoMarketCode;
  uuid: string;
  identifier?: string | null;
  side: UpbitOrderSide | string;
  ordType: UpbitOrderType | string;
  state: UpbitOrderState | 'trade' | 'prevented' | string;
  price: DecimalString;
  volume: DecimalString;
  remainingVolume: DecimalString;
  executedVolume: DecimalString;
  paidFee: DecimalString;
  locked: DecimalString;
  tradeUuid?: string | null;
  tradeFee?: DecimalString | null;
  executedFunds?: DecimalString;
  orderTimestamp: number;
  tradeTimestamp?: number | null;
  timestamp: number;
  raw?: unknown;
}

export interface CryptoPrivateAssetEvent {
  exchange: CryptoExchangeId;
  accountId: number;
  assets: Array<{
    currency: string;
    balance: DecimalString;
    locked: DecimalString;
  }>;
  timestamp: number;
  raw?: unknown;
}

export interface CryptoOrderTrade {
  uuid: string;
  market?: CryptoMarketCode | string;
  side?: string;
  price: DecimalString;
  volume: DecimalString;
  funds: DecimalString;
  fee?: DecimalString;
  createdAt: number;
  raw?: unknown;
}

export interface CryptoOrderSnapshot {
  uuid: string;
  identifier?: string;
  market: CryptoMarketCode;
  side: UpbitOrderSide | string;
  ordType: UpbitOrderType | string;
  state: UpbitOrderState | string;
  price?: DecimalString;
  volume?: DecimalString;
  remainingVolume: DecimalString;
  executedVolume: DecimalString;
  paidFee: DecimalString;
  locked: DecimalString;
  placedAt: number;
  trades?: CryptoOrderTrade[];
  raw?: unknown;
}

export interface CryptoOrderDetail extends CryptoOrderSnapshot {
  accountId: number;
  exchange: CryptoExchangeId;
  averageExecutedPrice: DecimalString;
  totalExecutedFunds: DecimalString;
  totalFee: DecimalString;
  fillCount: number;
  trades: CryptoOrderTrade[];
  updatedAt: number;
}

export type CryptoRealtimeSessionState =
  | 'connecting'
  | 'open'
  | 'stale'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface CryptoRealtimeSessionStatus {
  key: string;
  kind: 'public' | 'private';
  state: CryptoRealtimeSessionState;
  refs: number;
  market?: CryptoMarketCode | string;
  candleUnit?: CryptoCandleUnit;
  accountId?: number;
  lastMessageAt: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  reconnectDelayMs: number | null;
  staleAfterMs: number;
}

export interface CryptoRealtimeStatus {
  publicSessions: CryptoRealtimeSessionStatus[];
  privateSessions: CryptoRealtimeSessionStatus[];
}

export interface CryptoRealtimeCheckpoint {
  accountId: number;
  exchange: CryptoExchangeId;
  stream: string;
  lastEventAt: number;
  cursor: unknown;
  updatedAt: number;
}

export interface CryptoReconcileResult {
  accountId: number;
  exchange: CryptoExchangeId;
  reason: 'startup' | 'watch-private' | 'reconnect' | 'manual';
  openOrders: number;
  closedOrders: number;
  detailedOrders: number;
  persistedFills: number;
  checkpointAt: number;
}

export interface CryptoReadonlySmokeResult {
  accountId: number;
  exchange: CryptoExchangeId;
  checkedAt: number;
  balances: {
    ok: boolean;
    count: number;
    error: string | null;
  };
  privateWs: {
    ok: boolean;
    state: CryptoRealtimeSessionState | 'unavailable';
    lastMessageAt: number | null;
    lastError: string | null;
    error: string | null;
  };
  reconciliation: {
    ok: boolean;
    result: CryptoReconcileResult | null;
    error: string | null;
  };
  dangerousCallsBlocked: true;
}
