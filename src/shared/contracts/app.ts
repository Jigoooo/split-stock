import { z } from 'zod';

/**
 * 앱 환경 — 모의투자(MOCK) / 실전(PROD).
 * 전환 시 반드시 사용자 명시 확인.
 */
export const AppEnvSchema = z.enum(['MOCK', 'PROD']);
export type AppEnv = z.infer<typeof AppEnvSchema>;

/**
 * 증권사 자격 증명. 저장 시 반드시 safeStorage로 암호화.
 * accessToken은 24h 유효, 만료 6h 이내면 기존 토큰 재사용.
 */
export const CredentialsSchema = z.object({
  env: AppEnvSchema,
  appKey: z.string().min(10),
  appSecret: z.string().min(10),
  accountNo8: z.string().regex(/^\d{8}$/, 'CANO(앞 8자리)는 숫자 8자리여야 합니다'),
  accountProdCd: z.string().regex(/^\d{2}$/, 'ACNT_PRDT_CD(뒤 2자리)는 숫자 2자리여야 합니다'),
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
