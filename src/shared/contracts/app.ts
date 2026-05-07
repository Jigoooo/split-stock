import { z } from 'zod';

/**
 * 앱 환경 — 모의투자(MOCK) / 실전(PROD).
 * 전환 시 반드시 사용자 명시 확인.
 */
export const AppEnvSchema = z.enum(['MOCK', 'PROD']);
export type AppEnv = z.infer<typeof AppEnvSchema>;

/**
 * KIS 종합계좌 상품코드(ACNT_PRDT_CD).
 * 이 앱은 국내주식 전용이라 '01'만 지원하지만, 타입/라벨을 명시해두면
 * 추후 해외주식('22')·선물옵션('03') 등 확장 시 한 곳만 수정하면 된다.
 */
export const AccountProdCodeSchema = z.enum(['01']);
export type AccountProdCode = z.infer<typeof AccountProdCodeSchema>;

export const ACCOUNT_PROD_CODE_LABEL: Record<AccountProdCode, string> = {
  '01': '국내주식',
};

export const ACCOUNT_PROD_CODE_OPTIONS: ReadonlyArray<{
  value: AccountProdCode;
  label: string;
}> = (Object.keys(ACCOUNT_PROD_CODE_LABEL) as AccountProdCode[]).map((value) => ({
  value,
  label: `${ACCOUNT_PROD_CODE_LABEL[value]} (${value})`,
}));

const DomesticCredentialsBrokerIdSchema = z.enum(['KIS', 'KIWOOM']);

/**
 * 국내주식 증권사 자격 증명. 저장 시 반드시 safeStorage로 암호화.
 * accessToken은 24h 유효, 만료 6h 이내면 기존 토큰 재사용.
 *
 * Stage 5c: broker 필드 추가. 기존 행은 default 'KIS' 로 backfill (zod default).
 * Kiwoom 활성화는 Stage 6.6 이후. Stage 5b 에서 wizard UI 가 broker 선택 후 저장.
 */
export const DomesticStockCredentialsSchema = z.object({
  env: AppEnvSchema,
  broker: DomesticCredentialsBrokerIdSchema.default('KIS'),
  appKey: z.string().min(10),
  appSecret: z.string().min(10),
  accountNo8: z.string().regex(/^\d{8}$/, 'CANO(앞 8자리)는 숫자 8자리여야 합니다'),
  accountProdCd: AccountProdCodeSchema,
  htsId: z.string().optional(),
});
export type DomesticStockCredentials = z.infer<typeof DomesticStockCredentialsSchema>;

/**
 * Upbit 코인거래소 자격 증명.
 * Upbit은 모의투자 환경이 없으므로 이 앱에서는 PROD만 저장한다.
 */
export const UpbitCredentialsSchema = z.object({
  env: z.literal('PROD'),
  broker: z.literal('UPBIT'),
  accessKey: z.string().trim().min(10),
  secretKey: z.string().trim().min(10),
});
export type UpbitCredentials = z.infer<typeof UpbitCredentialsSchema>;

export const CredentialsSchema = z.union([DomesticStockCredentialsSchema, UpbitCredentialsSchema]);
export type Credentials = z.infer<typeof CredentialsSchema>;

export function isUpbitCredentials(
  value: Credentials,
): value is z.infer<typeof UpbitCredentialsSchema> {
  return value.broker === 'UPBIT';
}

export function getCredentialsAccountRef(value: Credentials): {
  accountNo8: string;
  accountProdCd: string;
} {
  if (isUpbitCredentials(value)) {
    return {
      accountNo8: 'UPBIT***',
      accountProdCd: 'CRYPTO',
    };
  }
  return { accountNo8: value.accountNo8, accountProdCd: value.accountProdCd };
}

export function getCredentialsProviderLabel(provider: Credentials['broker']): string {
  switch (provider) {
    case 'KIS':
      return '한국투자증권';
    case 'KIWOOM':
      return '키움증권';
    case 'UPBIT':
      return '업비트';
  }
}

/**
 * 저장된 액세스 토큰 — 자동 갱신 대상.
 */
export const AccessTokenSchema = z.object({
  token: z.string().min(1),
  tokenType: z.string().default('Bearer'),
  expiresAt: z.number().int().positive(),
});
export type AccessToken = z.infer<typeof AccessTokenSchema>;

/**
 * 안전 3계층 플래그 (런타임 비휘발).
 */
export const SafetyFlagsSchema = z.object({
  master: z.boolean(),
  errorLock: z.boolean(),
  errorReason: z.string().nullable(),
  updatedAt: z.number().int().positive(),
});
export type SafetyFlags = z.infer<typeof SafetyFlagsSchema>;

export const WatchOutcomeStatusSchema = z.enum(['EXECUTED', 'FAILED', 'EXPIRED']);
export type WatchOutcomeStatus = z.infer<typeof WatchOutcomeStatusSchema>;

export const WatchOutcomeEventSchema = z.object({
  watchId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  pdno: z.string().regex(/^\d{6}$/),
  source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']),
  side: z.enum(['BUY', 'SELL']),
  status: WatchOutcomeStatusSchema,
  targetPrice: z.number().int().positive(),
  triggerPrice: z.number().int().positive().nullable(),
  orderType: z.enum(['MARKET', 'LIMIT']),
  failureReason: z.string().nullable(),
  occurredAt: z.number().int().positive(),
});
export type WatchOutcomeEvent = z.infer<typeof WatchOutcomeEventSchema>;

export const AutoOrderRetryStatusSchema = z.enum([
  'RETRYING',
  'WAITING_CONDITION',
  'NEEDS_ATTENTION',
  'RECONCILED',
]);
export type AutoOrderRetryStatus = z.infer<typeof AutoOrderRetryStatusSchema>;

const AutoOrderRetryErrorKindSchema = z.enum([
  'NETWORK',
  'RATE_LIMITED',
  'AUTH_FAILED',
  'VALIDATION',
  'BUSINESS',
  'NOT_IMPLEMENTED',
  'UNKNOWN',
]);

export const AutoOrderRetryEventSchema = z
  .object({
    accountId: z.number().int().positive(),
    pdno: z.string().regex(/^\d{6}$/),
    side: z.enum(['BUY', 'SELL']),
    nth: z.number().int().positive(),
    triggerReason: z.enum(['DROP_BUY', 'PROFIT_SELL']),
    failureType: z.enum(['BLOCKED', 'FAILED']),
    status: AutoOrderRetryStatusSchema,
    attempt: z.number().int().positive(),
    errorKind: AutoOrderRetryErrorKindSchema.optional(),
    price: z.number().int().positive(),
    qty: z.number().int().positive(),
    reason: z.string().min(1),
    retryAfterMs: z.number().int().nonnegative().nullable(),
    occurredAt: z.number().int().positive(),
  })
  .superRefine((event, ctx) => {
    if (event.side === 'BUY' && event.triggerReason !== 'DROP_BUY') {
      ctx.addIssue({
        code: 'custom' as const,
        message: 'BUY retry event must use DROP_BUY triggerReason',
        path: ['triggerReason'],
      });
    }
    if (event.side === 'SELL' && event.triggerReason !== 'PROFIT_SELL') {
      ctx.addIssue({
        code: 'custom' as const,
        message: 'SELL retry event must use PROFIT_SELL triggerReason',
        path: ['triggerReason'],
      });
    }
  });
export type AutoOrderRetryEvent = z.infer<typeof AutoOrderRetryEventSchema>;

export const TradeExecutionStatusSchema = z.enum(['PARTIAL', 'FILLED']);
export type TradeExecutionStatus = z.infer<typeof TradeExecutionStatusSchema>;

export const TradeExecutionEventSchema = z.object({
  accountId: z.number().int().positive(),
  odno: z.string().min(1),
  pdno: z.string().regex(/^\d{6}$/),
  name: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  status: TradeExecutionStatusSchema,
  filledQty: z.number().int().positive(),
  totalFilledQty: z.number().int().positive(),
  remainingQty: z.number().int().nonnegative(),
  lotId: z.number().int().positive().nullable().optional(),
  nth: z.number().int().positive().nullable().optional(),
  price: z.number().int().positive(),
  occurredAt: z.number().int().positive(),
});
export type TradeExecutionEvent = z.infer<typeof TradeExecutionEventSchema>;

/**
 * SWR 백그라운드 재검증 성공 시 main → renderer IPC push 페이로드.
 * swrRevalidator 가 fresh candles 를 받으면 broadcastToAllWindows 로 전파.
 * renderer 는 이 이벤트를 수신해 캐시를 업데이트한다 (Sub-AC 3-2-2).
 */
export const CandlesUpdatedEventSchema = z.object({
  pdno: z.string(),
  period: z.enum(['D', 'W', 'M']),
  candles: z.array(
    z.object({
      date: z.string(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
    }),
  ),
});
export type CandlesUpdatedEvent = z.infer<typeof CandlesUpdatedEventSchema>;

/**
 * RateGuard 가 종목/마켓을 SELL_ONLY 로 자동 전환했음을 renderer 에 알림.
 *
 * - log only 였던 회귀를 차단해 사용자가 즉시 인지 가능.
 * - scope='KIS' 는 도메스틱 종목 (symbol = pdno 6자리), 'UPBIT' 는 코인 마켓 (symbol = KRW-XXX).
 * - renderer 는 이 이벤트를 수신해 toast/banner 표시 + 자동매매 화면 query invalidate.
 */
export const AutoSellOnlyEventSchema = z.object({
  scope: z.enum(['KIS', 'UPBIT']),
  accountId: z.number().int().positive(),
  symbol: z.string().min(1),
  name: z.string().nullable(),
  count: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
  occurredAt: z.number().int().positive(),
});
export type AutoSellOnlyEvent = z.infer<typeof AutoSellOnlyEventSchema>;

export const EventLogPushSchema = z.object({
  id: z.number().int().positive(),
  ts: z.number().int().positive(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  category: z.string().min(1),
  message: z.string().min(1),
  payloadJson: z.string().nullable(),
});
export type EventLogPush = z.infer<typeof EventLogPushSchema>;
