import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export interface RecommendedItem {
  pdno: string;
  name: string;
  score: number;
  volatilityFit: 'low' | 'mid' | 'high';
  liquidityFit: 'good' | 'ok' | 'poor';
  summary: string;
  pros: string[];
  cons: string[];
  entryNote: string | null;
  sources: ReadonlyArray<'OWNED' | 'WATCH' | 'MANUAL'>;
  stats: {
    lastClose: number | null;
    volatility60d: number | null;
    avgVolume60d: number | null;
    rangePct120d: number | null;
  };
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

  // 모달 세션 동안 사용자가 stock-picker 로 추가한 pdno 목록 (max 10).
  const [extraPdnos, setExtraPdnos] = useState<string[]>([]);

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
    mut.mutate({ topN: 5, ...(extraPdnos.length > 0 ? { extraPdnos } : {}) });
  };

  const close = (): void => {
    setView((prev) => ({ ...prev, isOpen: false }));
  };

  const refresh = (): void => {
    setView((prev) => ({ ...prev, isPending: true, error: null }));
    mut.mutate({ topN: 5, ...(extraPdnos.length > 0 ? { extraPdnos } : {}) });
  };

  const addExtraPdno = (pdno: string): void => {
    setExtraPdnos((prev) => {
      if (prev.length >= 10) return prev;
      const padded = pdno.padStart(6, '0');
      if (!/^\d{6}$/.test(padded)) return prev;
      if (prev.includes(padded)) return prev;
      return [...prev, padded];
    });
  };

  const removeExtraPdno = (pdno: string): void => {
    setExtraPdnos((prev) => prev.filter((p) => p !== pdno));
  };

  return {
    view,
    hasDefaultKey,
    isAiListLoading: aiList.isLoading,
    extraPdnos,
    open,
    close,
    refresh,
    addExtraPdno,
    removeExtraPdno,
  };
}
