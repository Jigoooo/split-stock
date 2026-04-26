import { trpc } from '@renderer/shared/api/trpc';
import { useRef, useState } from 'react';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — LLM 비용 절감 + 모달 재오픈 시 즉시 표시.

interface RecommendCache {
  ranked: RecommendedItem[];
  userInputResults: RecommendedItem[];
  distribution: TierDistribution;
  emptyReason: string | null;
  rejectedCount: number;
  durationMs: number;
  extras: ReadonlyArray<string>;
  aiOff: boolean;
  includeAutoDiscovery: boolean;
  fetchedAt: number;
}

export interface RecommendedNewsItem {
  publishedAt: string;
  title: string;
  summary: string;
  link: string;
}

export type RecommendTier = 'top' | 'strong' | 'moderate' | 'watch' | 'avoid';
export type RecommendConfidence = 'high' | 'med' | 'low';

export interface TierDistribution {
  top: number;
  strong: number;
  moderate: number;
  watch: number;
  avoid: number;
}

export interface IndicatorReason {
  indicator: string;
  value: string;
  meaning: string;
}

export interface RecommendedItem {
  pdno: string;
  name: string;
  score: number;
  tier: RecommendTier;
  confidence: RecommendConfidence;
  volatilityFit: 'low' | 'mid' | 'high';
  liquidityFit: 'good' | 'ok' | 'poor';
  summary: string;
  pros: string[];
  cons: string[];
  entryNote: string | null;
  consensusCount: number;
  citedTools: string[];
  sources: ReadonlyArray<'OWNED' | 'WATCH' | 'MANUAL' | 'AUTO'>;
  stats: {
    lastClose: number | null;
    volatility60d: number | null;
    avgVolume60d: number | null;
    rangePct120d: number | null;
  };
  algoScore: number | null;
  algoLabels: ReadonlyArray<string>;
  aiOff: boolean;
  news: ReadonlyArray<RecommendedNewsItem>;
  conflicts: ReadonlyArray<string>;
  indicatorReasons: ReadonlyArray<IndicatorReason>;
}

export interface RecommendationViewState {
  isOpen: boolean;
  isPending: boolean;
  ranked: RecommendedItem[];
  /** 사용자가 입력한 종목(extras) 의 별도 평가 결과. recommended 와 분리. */
  userInputResults: RecommendedItem[];
  /** Tier 분포 — 모달 헤더 chip 표시용. */
  distribution: TierDistribution;
  emptyReason: string | null;
  rejectedCount: number;
  durationMs: number;
  error: string | null;
  /** 마지막 추천 결과 적재 시각 (ms epoch) — 캐시 anniversary 표시용. */
  lastFetchedAt: number | null;
  /** true 면 마지막 mutation 없이 캐시에서 복원된 결과. UI 가 "캐시됨" 안내. */
  fromCache: boolean;
}

const EMPTY_DIST: TierDistribution = { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 };

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
    userInputResults: [],
    distribution: EMPTY_DIST,
    emptyReason: null,
    rejectedCount: 0,
    durationMs: 0,
    error: null,
    lastFetchedAt: null,
    fromCache: false,
  });
  const cacheRef = useRef<RecommendCache | null>(null);

  const aiList = trpc.ai.listConfigs.useQuery();
  const hasDefaultKey = (aiList.data?.configs ?? []).some((c) => c.isDefault);

  // 모달 세션 동안 사용자가 stock-picker 로 추가한 pdno 목록 (max 10).
  const [extraPdnos, setExtraPdnos] = useState<string[]>([]);
  // AI 끄기 모드 — LLM 호출 없이 알고리즘 신호만으로 ranking. 키 미설정 시 자동 fallback.
  const [aiOff, setAiOff] = useState(false);
  // D 풀 (자동 발굴) 활성화 — A∪B∪C 외에도 매직스플릿 사전 스크리닝 통과 종목 포함.
  const [includeAutoDiscovery, setIncludeAutoDiscovery] = useState(true);

  const mut = trpc.ai.suggestSymbols.useMutation({
    onSuccess: (res) => {
      const fetchedAt = Date.now();
      const distribution: TierDistribution =
        (res as { distribution?: TierDistribution }).distribution ?? EMPTY_DIST;
      const userInputResults: RecommendedItem[] =
        (res as { userInputResults?: RecommendedItem[] }).userInputResults ?? [];
      cacheRef.current = {
        ranked: res.ranked,
        userInputResults,
        distribution,
        emptyReason: res.emptyReason,
        rejectedCount: res.rejectedCount,
        durationMs: res.durationMs,
        extras: [...extraPdnos],
        aiOff,
        includeAutoDiscovery,
        fetchedAt,
      };
      setView((prev) => ({
        ...prev,
        isPending: false,
        ranked: res.ranked,
        userInputResults,
        distribution,
        emptyReason: res.emptyReason,
        rejectedCount: res.rejectedCount,
        durationMs: res.durationMs,
        lastFetchedAt: fetchedAt,
        fromCache: false,
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
    const cached = cacheRef.current;
    const sameExtras =
      cached !== null &&
      cached.extras.length === extraPdnos.length &&
      cached.extras.every((p, i) => p === extraPdnos[i]);
    const sameMode = cached !== null && cached.aiOff === aiOff;
    const sameAuto = cached !== null && cached.includeAutoDiscovery === includeAutoDiscovery;
    const fresh = cached !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    if (cached && sameExtras && sameMode && sameAuto && fresh) {
      setView({
        isOpen: true,
        isPending: false,
        ranked: cached.ranked,
        userInputResults: cached.userInputResults,
        distribution: cached.distribution,
        emptyReason: cached.emptyReason,
        rejectedCount: cached.rejectedCount,
        durationMs: cached.durationMs,
        lastFetchedAt: cached.fetchedAt,
        fromCache: true,
        error: null,
      });
      return;
    }
    setView({
      isOpen: true,
      isPending: false,
      ranked: [],
      userInputResults: [],
      distribution: EMPTY_DIST,
      emptyReason: null,
      rejectedCount: 0,
      durationMs: 0,
      lastFetchedAt: null,
      fromCache: false,
      error: null,
    });
  };

  const analyze = (): void => {
    cacheRef.current = null;
    setView((prev) => ({ ...prev, isPending: true, fromCache: false, error: null }));
    mut.mutate({
      topN: 8,
      ...(extraPdnos.length > 0 ? { extraPdnos } : {}),
      ...(aiOff ? { aiOff: true } : {}),
      includeAutoDiscovery,
    });
  };

  const close = (): void => {
    setView((prev) => ({ ...prev, isOpen: false }));
  };

  const toggleAiOff = (next: boolean): void => {
    setAiOff(next);
    cacheRef.current = null;
  };

  const toggleAutoDiscovery = (next: boolean): void => {
    setIncludeAutoDiscovery(next);
    cacheRef.current = null;
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
    aiOff,
    includeAutoDiscovery,
    open,
    close,
    analyze,
    addExtraPdno,
    removeExtraPdno,
    toggleAiOff,
    toggleAutoDiscovery,
  };
}
