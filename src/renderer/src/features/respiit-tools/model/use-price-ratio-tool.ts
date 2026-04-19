import type { RespiitPlan } from '@main/trading/respiit-planner';
import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

interface UseRatioPriceToolReturn {
  pdno: string | null;
  stages: number[] | 'all';
  ratioPct: number;
  isLoading: boolean;
  error: string | null;
  preview: RespiitPlan | null;
  setPdno: (pdno: string | null) => void;
  setStages: (stages: number[] | 'all') => void;
  setRatioPct: (ratioPct: number) => void;
  generatePreview: (plan: RespiitPlan | null) => void;
  apply: () => Promise<void>;
}

export function usePriceRatioTool(): UseRatioPriceToolReturn {
  const [pdno, setPdno] = useState<string | null>(null);
  const [stages, setStages] = useState<number[] | 'all'>('all');
  const [ratioPct, setRatioPct] = useState(0);
  const [preview, setPreview] = useState<RespiitPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyMutation = trpc.strategy.applyPriceRatio.useMutation();

  const generatePreview = (plan: RespiitPlan | null): void => {
    if (!plan) {
      setPreview(null);
      return;
    }

    try {
      // applyPriceRatio 로직을 클라이언트에서 재현 (또는 서버 미리보기 엔드포인트 사용)
      const multiplier = 1 + ratioPct / 100;
      const stageSet = stages === 'all' ? new Set(plan.entries.map((e) => e.nth)) : new Set(stages);

      const newEntries = plan.entries.map((entry) => {
        if (!stageSet.has(entry.nth)) {
          return entry;
        }
        const newPrice = Math.max(1, Math.round(entry.buyPrice * multiplier));
        return {
          ...entry,
          buyPrice: newPrice,
          amountKrw: newPrice * entry.qty,
        };
      });

      setPreview({ pdno: plan.pdno, entries: newEntries });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const apply = async (): Promise<void> => {
    if (!pdno) {
      setError('종목이 선택되지 않았습니다');
      return;
    }

    try {
      await applyMutation.mutateAsync({
        pdno,
        stages,
        ratioPct,
      });
      setError(null);
      setRatioPct(0);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '적용 실패');
    }
  };

  return {
    pdno,
    stages,
    ratioPct,
    isLoading: applyMutation.isPending,
    error,
    preview,
    setPdno,
    setStages,
    setRatioPct,
    generatePreview,
    apply,
  };
}
