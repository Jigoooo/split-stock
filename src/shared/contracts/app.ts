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

/**
 * 증권사 자격 증명. 저장 시 반드시 safeStorage로 암호화.
 * accessToken은 24h 유효, 만료 6h 이내면 기존 토큰 재사용.
 *
 * Stage 5c: broker 필드 추가. 기존 행은 default 'KIS' 로 backfill (zod default).
 * Kiwoom 활성화는 Stage 6.6 이후. Stage 5b 에서 wizard UI 가 broker 선택 후 저장.
 */
export const CredentialsSchema = z.object({
  env: AppEnvSchema,
  broker: z.enum(['KIS', 'KIWOOM']).default('KIS'),
  appKey: z.string().min(10),
  appSecret: z.string().min(10),
  accountNo8: z.string().regex(/^\d{8}$/, 'CANO(앞 8자리)는 숫자 8자리여야 합니다'),
  accountProdCd: AccountProdCodeSchema,
  htsId: z.string().optional(),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

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
