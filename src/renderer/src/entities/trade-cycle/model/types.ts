import { z } from 'zod';

/**
 * 매매 사이클 — 서버 TradeCycle (lots-repo) 의 클라이언트 mirror.
 *
 * status 매핑:
 *   - 'OPEN'    : 보유 중 (매수 완료, 매도 전)
 *   - 'BUYING'  : 매수 진행 중
 *   - 'SELLING' : 매도 진행 중
 *   - 'SOLD'    : 매도 완료
 */
export const TradeCycleSchema = z.object({
  id: z.number().int().positive(),
  nth: z.number().int().positive(),
  pdno: z.string().regex(/^\d{6}$/),
  name: z.string(),
  buyPrice: z.number(),
  qty: z.number().int(),
  amountKrw: z.number(),
  status: z.enum(['OPEN', 'BUYING', 'SELLING', 'SOLD']),
  boughtAt: z.number(), // ms epoch
  soldAt: z.number().optional(),
  sellPrice: z.number().optional(),
  pnl: z.number().optional(), // 원(KRW)
  pnlRate: z.number().optional(), // 백분율 (예: 5.25 == 5.25%)
});

export type TradeCycle = z.infer<typeof TradeCycleSchema>;

export type CycleStatusFilter = 'all' | 'open' | 'closed';
