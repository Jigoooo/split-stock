import { startTransition, useState } from 'react';

export type DropBaseline = 'PREV_LOT' | 'FIRST_LOT';

export interface StageGridRaw {
  dropPct: string;
  profitPct: string;
}

/** 개별 차수 행 (1-indexed) */
export interface StageRow {
  /** 1-indexed 차수 번호 */
  stage: number;
  /** 하향 감지% 문자열 */
  dropPct: string;
  /** 매수금액(원) 문자열 */
  amountKrw: string;
}

export interface AutoFillParams {
  /** 감지% 간격 (양수, 예: "3") */
  dropPctInterval: string;
  /** 매수금액 (원, 예: "100000") */
  amountKrw: string;
  baseline: DropBaseline;
  maxStages: number;
}

export interface UseStageGridReturn {
  raw: StageGridRaw;
  rows: StageRow[];
  dropBaseline: DropBaseline;
  update: (key: keyof StageGridRaw) => (value: string) => void;
  toggleDropBaseline: () => void;
  autoFill: (params: AutoFillParams) => void;
}

/**
 * 차수 그리드 상태 hook.
 * - dropPct / profitPct 는 퍼센트 문자열 (0.03 → '3')
 * - dropBaseline: 하향매수 기준가 ('PREV_LOT' = 직전차수, 'FIRST_LOT' = 처음매수가)
 * - rows: 1~maxStages 차수별 독립 행 (autoFill 로 채움)
 * - 50차 그리드 입력 시 useTransition 으로 재계산 우선순위 낮춤
 */
export function useStageGrid(initialRaw: StageGridRaw): UseStageGridReturn {
  const [raw, setRaw] = useState<StageGridRaw>(initialRaw);
  const [dropBaseline, setDropBaseline] = useState<DropBaseline>('PREV_LOT');
  const [rows, setRows] = useState<StageRow[]>([]);

  const update = (key: keyof StageGridRaw) => (value: string) => {
    startTransition(() => {
      setRaw((prev) => ({ ...prev, [key]: value }));
    });
  };

  const toggleDropBaseline = (): void => {
    setDropBaseline((prev) => (prev === 'PREV_LOT' ? 'FIRST_LOT' : 'PREV_LOT'));
  };

  /**
   * 1~maxStages 차수를 일괄 채운다.
   *
   * PREV_LOT (직전차수 기준):
   *   모든 차수의 dropPct = interval (직전 대비 동일 비율)
   *
   * FIRST_LOT (처음매수가 기준):
   *   N차의 dropPct = N * interval (1차 기준 누적)
   */
  const autoFill = (params: AutoFillParams): void => {
    const interval = Number(params.dropPctInterval);
    const amount = params.amountKrw.trim();
    if (!Number.isFinite(interval) || interval <= 0) return;

    startTransition(() => {
      setRows(
        Array.from({ length: params.maxStages }, (_, i) => {
          const stage = i + 1;
          const dropPct =
            params.baseline === 'FIRST_LOT' ? String(stage * interval) : String(interval);
          return { stage, dropPct, amountKrw: amount };
        }),
      );
    });
  };

  return { raw, rows, dropBaseline, update, toggleDropBaseline, autoFill };
}
