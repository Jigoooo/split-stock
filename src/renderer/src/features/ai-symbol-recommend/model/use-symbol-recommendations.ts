import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useRef, useState } from 'react';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — LLM 비용 절감 + 모달 재오픈 시 즉시 표시.

interface ProgressStage {
  key: string;
  atMs: number;
  percent: number;
  label: string;
  detail: string;
}

const AI_PROGRESS_STAGES: ReadonlyArray<ProgressStage> = [
  {
    key: 'pool',
    atMs: 0,
    percent: 0,
    label: '후보 풀 구성 중',
    detail: '보유/감시/관심 종목을 모으는 중입니다.',
  },
  {
    key: 'signals',
    atMs: 1_500,
    percent: 24,
    label: '일봉과 지표 계산 중',
    detail: '가격 캐시와 매직스플릿 신호를 계산하는 중입니다.',
  },
  {
    key: 'context',
    atMs: 4_000,
    percent: 42,
    label: '시장 컨텍스트 확인 중',
    detail: 'KRX/ECOS 캐시와 후보별 보조 데이터를 확인하는 중입니다.',
  },
  {
    key: 'news',
    atMs: 7_500,
    percent: 58,
    label: '뉴스와 공시 근거 수집 중',
    detail: 'AI 판단에 필요한 외부 근거를 압축하는 중입니다.',
  },
  {
    key: 'llm',
    atMs: 12_000,
    percent: 74,
    label: 'AI 종합 판단 중',
    detail: '점수, 리스크, consensus를 함께 검토하는 중입니다.',
  },
  {
    key: 'finalize',
    atMs: 22_000,
    percent: 90,
    label: '추천 결과 정리 중',
    detail: '응답 형식과 후보 풀 일치 여부를 검증하는 중입니다.',
  },
];

const ALGO_PROGRESS_STAGES: ReadonlyArray<ProgressStage> = [
  {
    key: 'pool',
    atMs: 0,
    percent: 0,
    label: '후보 풀 구성 중',
    detail: '보유/감시/관심 종목을 모으는 중입니다.',
  },
  {
    key: 'signals',
    atMs: 1_000,
    percent: 42,
    label: '일봉과 지표 계산 중',
    detail: '가격 캐시와 매직스플릿 신호를 계산하는 중입니다.',
  },
  {
    key: 'context',
    atMs: 2_500,
    percent: 70,
    label: '시장 컨텍스트 확인 중',
    detail: 'KRX/ECOS 캐시 상태를 결과에 붙이는 중입니다.',
  },
  {
    key: 'finalize',
    atMs: 4_000,
    percent: 92,
    label: '추천 결과 정리 중',
    detail: '알고리즘 점수와 리스크 문구를 정리하는 중입니다.',
  },
];

const INITIAL_PROGRESS_STAGE: ProgressStage = {
  key: 'pool',
  atMs: 0,
  percent: 0,
  label: '후보 풀 구성 중',
  detail: '보유/감시/관심 종목을 모으는 중입니다.',
};

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

interface ActiveRecommendRequest {
  extras: string[];
  aiOff: boolean;
  includeAutoDiscovery: boolean;
  startedAt: number;
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
  marketContext: {
    krx: {
      date: string;
      close: number | null;
      changeRate: number | null;
      volume: number | null;
      tradeValue: number | null;
      marketCap: number | null;
    } | null;
    ecos: ReadonlyArray<{
      indicator: string;
      date: string;
      value: number;
      unitName: string | null;
    }>;
    status: {
      krx: { isAvailable: boolean; isStale: boolean; lastError: string | null };
      ecos: { isAvailable: boolean; isStale: boolean; lastError: string | null };
    };
  } | null;
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
  progress: RecommendationProgressState | null;
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

export interface RecommendationProgressState {
  key: string;
  percent: number;
  label: string;
  detail: string;
  elapsedMs: number;
}

const EMPTY_DIST: TierDistribution = { top: 0, strong: 0, moderate: 0, watch: 0, avoid: 0 };

function buildProgress(elapsedMs: number, aiOff: boolean): RecommendationProgressState {
  const stages = aiOff ? ALGO_PROGRESS_STAGES : AI_PROGRESS_STAGES;
  let stageIndex = 0;
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage && elapsedMs >= stage.atMs) stageIndex = i;
  }
  const current = stages[stageIndex] ?? stages[0] ?? INITIAL_PROGRESS_STAGE;
  const next = stages[stageIndex + 1];
  let percent = current.percent;

  if (next) {
    const span = Math.max(1, next.atMs - current.atMs);
    const ratio = Math.min(1, Math.max(0, (elapsedMs - current.atMs) / span));
    percent = current.percent + (next.percent - current.percent) * ratio;
  } else {
    const tailRatio = Math.min(1, Math.max(0, (elapsedMs - current.atMs) / 20_000));
    percent = current.percent + (96 - current.percent) * tailRatio;
  }

  return {
    key: current.key,
    percent: Math.round(percent),
    label: current.label,
    detail: current.detail,
    elapsedMs,
  };
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
    progress: null,
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
  const activeRequestRef = useRef<ActiveRecommendRequest | null>(null);

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
      const request = activeRequestRef.current;
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
        extras: request?.extras ?? [...extraPdnos],
        aiOff: request?.aiOff ?? aiOff,
        includeAutoDiscovery: request?.includeAutoDiscovery ?? includeAutoDiscovery,
        fetchedAt,
      };
      activeRequestRef.current = null;
      setView((prev) => ({
        ...prev,
        isPending: false,
        progress: null,
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
      activeRequestRef.current = null;
      setView((prev) => ({
        ...prev,
        isPending: false,
        progress: null,
        error: err.message,
      }));
    },
  });

  useEffect(() => {
    if (!view.isPending) return;
    const request = activeRequestRef.current;
    const startedAt = request?.startedAt ?? Date.now();
    const requestAiOff = request?.aiOff ?? aiOff;

    const tick = (): void => {
      setView((prev) => {
        if (!prev.isPending) return prev;
        return {
          ...prev,
          progress: buildProgress(Date.now() - startedAt, requestAiOff),
        };
      });
    };

    tick();
    const id = window.setInterval(tick, 800);
    return () => window.clearInterval(id);
  }, [aiOff, view.isPending]);

  const syncPendingOpen = (): void => {
    const request = activeRequestRef.current ?? {
      extras: [...extraPdnos],
      aiOff,
      includeAutoDiscovery,
      startedAt: Date.now(),
    };
    activeRequestRef.current = request;
    setView((prev) => ({
      ...prev,
      isOpen: true,
      isPending: true,
      progress: buildProgress(Date.now() - request.startedAt, request.aiOff),
      fromCache: false,
      error: null,
    }));
  };

  const open = (): void => {
    if (view.isPending || mut.isPending) {
      syncPendingOpen();
      return;
    }

    if (view.error) {
      setView((prev) => ({
        ...prev,
        isOpen: true,
        isPending: false,
        progress: null,
        fromCache: false,
      }));
      return;
    }

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
        progress: null,
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
      progress: null,
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
    if (view.isPending || mut.isPending) {
      syncPendingOpen();
      return;
    }

    const request: ActiveRecommendRequest = {
      extras: [...extraPdnos],
      aiOff,
      includeAutoDiscovery,
      startedAt: Date.now(),
    };
    activeRequestRef.current = request;
    cacheRef.current = null;
    setView((prev) => ({
      ...prev,
      isPending: true,
      progress: buildProgress(0, request.aiOff),
      fromCache: false,
      error: null,
    }));
    mut.mutate({
      topN: 8,
      ...(request.extras.length > 0 ? { extraPdnos: request.extras } : {}),
      ...(request.aiOff ? { aiOff: true } : {}),
      includeAutoDiscovery: request.includeAutoDiscovery,
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
