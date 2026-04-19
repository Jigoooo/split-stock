import { z } from 'zod';

export interface LotPlanEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  boughtAt: Date;
}

export interface RespiitPlan {
  pdno: string;
  entries: LotPlanEntry[];
}

export const RespiitParamsSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/),
  stages: z.number().int().min(1).max(20),
  intervalDays: z.number().int().min(0).max(365),
  /** 차수 간 가격 하락률. 0.03 = 차수마다 -3%. 0이면 동일 가격. */
  priceGapPct: z.number().min(0).max(0.5),
  /** 차수 간 가격 하락 고정 금액(원). priceGapPct와 병용 불가 — 둘 중 하나만. */
  priceGapKrw: z.number().int().min(0).optional(),
  totalQty: z.number().int().positive(),
  /** 1차 기준 매수가. */
  anchorPrice: z.number().int().positive(),
  /** 기준 시작 시각 (미지정 시 now). */
  anchorAt: z.date().optional(),
});
export type RespiitParams = z.infer<typeof RespiitParamsSchema>;

/**
 * 파라미터 기반 자동 구성.
 * - 각 차수 가격: anchorPrice * (1 - priceGapPct * (n-1))  또는  anchorPrice - priceGapKrw*(n-1)
 * - 각 차수 수량: totalQty / stages (floor), 잔여는 1차에 합산
 * - 각 차수 시점: anchorAt - intervalDays*(n-1) (과거로 역산)
 */
export function planFromParams(raw: unknown): RespiitPlan {
  const p = RespiitParamsSchema.parse(raw);
  const baseQty = Math.floor(p.totalQty / p.stages);
  const remainder = p.totalQty - baseQty * p.stages;
  const anchorAt = p.anchorAt ?? new Date();
  const entries: LotPlanEntry[] = [];
  for (let i = 0; i < p.stages; i++) {
    const nth = i + 1;
    const price =
      p.priceGapKrw !== undefined
        ? Math.max(1, p.anchorPrice - p.priceGapKrw * i)
        : Math.max(1, Math.round(p.anchorPrice * (1 - p.priceGapPct * i)));
    const qty = baseQty + (i === 0 ? remainder : 0);
    const boughtAt = new Date(anchorAt.getTime() - p.intervalDays * 86_400_000 * i);
    entries.push({
      nth,
      buyPrice: price,
      qty,
      amountKrw: price * qty,
      boughtAt,
    });
  }
  return { pdno: p.pdno, entries };
}

const CsvRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().positive(),
  price: z.number().int().positive(),
});

/**
 * CSV(헤더 없음, [날짜, 수량, 단가]) → Plan.
 * pdno는 CSV 외부에서 주입.
 */
export function planFromCsv(pdno: string, text: string): RespiitPlan {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: LotPlanEntry[] = [];
  rows.forEach((row, idx) => {
    const cols = row.split(',').map((c) => c.trim());
    const [dateStr, qtyStr, priceStr] = cols;
    const parsed = CsvRowSchema.parse({
      date: dateStr ?? '',
      qty: Number(qtyStr ?? 0),
      price: Number(priceStr ?? 0),
    });
    const nth = idx + 1;
    const qty = parsed.qty;
    const price = parsed.price;
    entries.push({
      nth,
      buyPrice: price,
      qty,
      amountKrw: price * qty,
      boughtAt: new Date(`${parsed.date}T00:00:00Z`),
    });
  });
  if (entries.length === 0) {
    throw new Error('CSV 행이 없습니다');
  }
  return { pdno, entries };
}

/**
 * 기존 Plan의 선택 차수 매입단가를 % 비율로 증감.
 * - stages: number[] (차수 번호 배열) 또는 'all' (전체)
 * - ratioPct: -50 ~ +50 (%), 예: +10 = 10% 인상, -5 = 5% 인하
 * 반환: 수정된 Plan (원본은 수정 안 함)
 */
export function applyPriceRatio(
  plan: RespiitPlan,
  options: { stages: number[] | 'all'; ratioPct: number },
): RespiitPlan {
  const { stages, ratioPct } = options;

  // 비율 유효성 검사
  if (ratioPct < -100 || ratioPct > 100) {
    throw new Error('ratioPct는 -100 ~ +100 범위여야 합니다');
  }

  const multiplier = 1 + ratioPct / 100;
  const stagesToUpdate = stages === 'all' ? plan.entries.map((e) => e.nth) : stages;
  const stageSet = new Set(stagesToUpdate);

  // 새 entries 생성 (원본 불변)
  const newEntries = plan.entries.map((entry) => {
    if (!stageSet.has(entry.nth)) {
      return entry; // 미지정 차수는 그대로
    }
    const newPrice = Math.max(1, Math.round(entry.buyPrice * multiplier));
    return {
      ...entry,
      buyPrice: newPrice,
      amountKrw: newPrice * entry.qty,
    };
  });

  return { pdno: plan.pdno, entries: newEntries };
}
