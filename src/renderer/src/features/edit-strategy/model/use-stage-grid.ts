import { startTransition, useState } from 'react';

export type DropBaseline = 'PREV_LOT' | 'FIRST_LOT';

export interface StageGridRaw {
  dropPct: string;
  profitPct: string;
}

export interface UseStageGridReturn {
  raw: StageGridRaw;
  dropBaseline: DropBaseline;
  update: (key: keyof StageGridRaw) => (value: string) => void;
  toggleDropBaseline: () => void;
}

/**
 * 차수 그리드 상태 hook.
 * - dropPct / profitPct 는 퍼센트 문자열 (0.03 → '3')
 * - dropBaseline: 하향매수 기준가 ('PREV_LOT' = 직전차수, 'FIRST_LOT' = 처음매수가)
 *   TODO(W0-1): persist dropBaseline to StrategyProfile DB column
 * - 50차 그리드 입력 시 useTransition 으로 재계산 우선순위 낮춤
 */
export function useStageGrid(initialRaw: StageGridRaw): UseStageGridReturn {
  const [raw, setRaw] = useState<StageGridRaw>(initialRaw);
  const [dropBaseline, setDropBaseline] = useState<DropBaseline>('PREV_LOT');

  const update = (key: keyof StageGridRaw) => (value: string) => {
    startTransition(() => {
      setRaw((prev) => ({ ...prev, [key]: value }));
    });
  };

  const toggleDropBaseline = (): void => {
    setDropBaseline((prev) => (prev === 'PREV_LOT' ? 'FIRST_LOT' : 'PREV_LOT'));
  };

  return { raw, dropBaseline, update, toggleDropBaseline };
}
