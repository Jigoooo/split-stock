import { z } from 'zod';

/**
 * 종목 메모 — 서버 symbolMemoRouter.get 반환 타입 mirror.
 * 메모가 없으면 null 반환.
 */
export const SymbolMemoSchema = z
  .object({
    content: z.string(),
    updatedAt: z.number(), // ms epoch
  })
  .nullable();

export type SymbolMemo = z.infer<typeof SymbolMemoSchema>;
