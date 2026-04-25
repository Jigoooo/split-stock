import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export interface RecommendedItem {
  pdno: string;
  name: string;
  score: number;
  volatilityFit: 'low' | 'mid' | 'high';
  liquidityFit: 'good' | 'ok' | 'poor';
  summary: string;
}

export interface RecommendationViewState {
  isOpen: boolean;
  isPending: boolean;
  ranked: RecommendedItem[];
  emptyReason: string | null;
  rejectedCount: number;
  durationMs: number;
  error: string | null;
}

/**
 * AI 매직스플릿 추천 hook — RecommendButton 클릭 시 mutation 트리거 + 결과 캐시.
 *
 * mutation 으로 사용 (idempotent X) — 매번 LLM 호출. 사용자가 재실행 명시.
 */
export function useSymbolRecommendations() {
  const [view, setView] = useState<RecommendationViewState>({
    isOpen: false,
    isPending: false,
    ranked: [],
    emptyReason: null,
    rejectedCount: 0,
    durationMs: 0,
    error: null,
  });

  const aiList = trpc.ai.listConfigs.useQuery();
  const hasDefaultKey = (aiList.data?.configs ?? []).some((c) => c.isDefault);

  const mut = trpc.ai.suggestSymbols.useMutation({
    onSuccess: (res) => {
      setView((prev) => ({
        ...prev,
        isPending: false,
        ranked: res.ranked,
        emptyReason: res.emptyReason,
        rejectedCount: res.rejectedCount,
        durationMs: res.durationMs,
        error: null,
      }));
    },
    onError: (err) => {
      setView((prev) => ({
        ...prev,
        isPending: false,
        error: err.message,
      }));
    },
  });

  const open = (): void => {
    setView({
      isOpen: true,
      isPending: true,
      ranked: [],
      emptyReason: null,
      rejectedCount: 0,
      durationMs: 0,
      error: null,
    });
    mut.mutate({ topN: 5 });
  };

  const close = (): void => {
    setView((prev) => ({ ...prev, isOpen: false }));
  };

  const refresh = (): void => {
    setView((prev) => ({ ...prev, isPending: true, error: null }));
    mut.mutate({ topN: 5 });
  };

  return {
    view,
    hasDefaultKey,
    isAiListLoading: aiList.isLoading,
    open,
    close,
    refresh,
  };
}
