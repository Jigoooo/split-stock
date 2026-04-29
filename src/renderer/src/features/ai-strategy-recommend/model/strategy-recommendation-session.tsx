import { trpc } from '@renderer/shared/api/trpc';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@shared/contracts';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

export type StrategyRecommendationApplyHandler = (
  profile: StrategyProfile,
  reasoning: string,
) => void;

export interface SuggestedStrategyView {
  profile: StrategyProfile;
  reasoning: string;
  stageRationales: ReadonlyArray<{
    nth: number;
    rationale: string;
    evidenceRefs: ReadonlyArray<string>;
  }>;
  globalRisks: ReadonlyArray<string>;
  evidenceRefs: ReadonlyArray<{ id: string; kind: string; title: string; detail: string }>;
  analysisConfidence: 'high' | 'med' | 'low';
  dataQuality: 'blocked' | 'limited' | 'normal';
  dataQualityReason?: string | undefined;
}

interface StrategyProgressStage {
  key: string;
  atMs: number;
  percent: number;
  label: string;
  detail: string;
}

export interface StrategyProgressState {
  key: string;
  percent: number;
  label: string;
  detail: string;
  elapsedMs: number;
}

export interface StrategyRecommendationViewState {
  isOpen: boolean;
  isPending: boolean;
  activePdno: string | null;
  suggested: SuggestedStrategyView | null;
  error: string | null;
  progress: StrategyProgressState | null;
}

export interface AppliedStrategyRecommendation {
  id: string;
  pdno: string;
  profile: StrategyProfile;
  reasoning: string;
}

export interface OpenStrategyRecommendationOptions {
  pdno: string;
}

const STRATEGY_PROGRESS_STAGES: ReadonlyArray<StrategyProgressStage> = [
  {
    key: 'prepare',
    atMs: 0,
    percent: 0,
    label: '종목 데이터 준비 중',
    detail: '차수 추천에 필요한 일봉 캐시와 종목 기본 정보를 확인하는 중입니다.',
  },
  {
    key: 'signals',
    atMs: 1_500,
    percent: 24,
    label: '변동성과 지표 계산 중',
    detail: '최근 가격 흐름, 박스권, 매직스플릿 신호를 계산하는 중입니다.',
  },
  {
    key: 'context',
    atMs: 4_000,
    percent: 42,
    label: '시장/수급/거시 컨텍스트 반영 중',
    detail: 'KRX/ECOS/FSC/KOSIS/EIA/Naver DataLab 중 사용 가능한 근거를 확인하는 중입니다.',
  },
  {
    key: 'evidence',
    atMs: 7_500,
    percent: 58,
    label: '뉴스와 공시 근거 수집 중',
    detail: 'Naver 뉴스와 DART 공시를 요약해 차수별 근거로 압축하는 중입니다.',
  },
  {
    key: 'llm',
    atMs: 12_000,
    percent: 76,
    label: 'AI 차수 설계 중',
    detail: '차수, 매수 금액, 익절률을 함께 맞춰 보는 중입니다.',
  },
  {
    key: 'validate',
    atMs: 22_000,
    percent: 91,
    label: '추천안 검증 중',
    detail: '응답 형식과 전략 프로필 적용 가능 여부를 확인하는 중입니다.',
  },
];

const INITIAL_VIEW: StrategyRecommendationViewState = {
  isOpen: false,
  isPending: false,
  activePdno: null,
  suggested: null,
  error: null,
  progress: null,
};

export function useStrategyRecommendationSessionValue() {
  const aiList = trpc.ai.listConfigs.useQuery();
  const hasDefaultKey = (aiList.data?.configs ?? []).some((c) => c.isDefault);
  const [view, setView] = useState<StrategyRecommendationViewState>(INITIAL_VIEW);
  const [lastApplied, setLastApplied] = useState<AppliedStrategyRecommendation | null>(null);
  const activePdnoRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const activeApplyConsumersRef = useRef<Set<string>>(new Set());

  const mut = trpc.ai.suggestStrategy.useMutation({
    onSuccess: (res) => {
      startedAtRef.current = null;
      const suggestion = res.suggestion;
      if (!suggestion) {
        setView((prev) => ({
          ...prev,
          isOpen: true,
          isPending: false,
          progress: null,
          suggested: null,
          error: res.emptyReason ?? 'AI 추천 결과가 없습니다.',
        }));
        return;
      }
      const profile = mergeIntoProfile(suggestion);
      setView((prev) => ({
        ...prev,
        isOpen: true,
        isPending: false,
        progress: null,
        error: null,
        suggested: {
          profile,
          reasoning: suggestion.reasoning,
          stageRationales: suggestion.stageRationales ?? [],
          globalRisks: suggestion.globalRisks ?? [],
          evidenceRefs: suggestion.evidenceRefs ?? [],
          analysisConfidence: suggestion.analysisConfidence ?? 'low',
          dataQuality: suggestion.dataQuality ?? res.dataQuality ?? 'blocked',
          dataQualityReason: res.dataQualityReason,
        },
      }));
    },
    onError: (err) => {
      startedAtRef.current = null;
      setView((prev) => ({
        ...prev,
        isOpen: true,
        isPending: false,
        progress: null,
        suggested: null,
        error: `AI strategy 추천 실패: ${err.message}`,
      }));
    },
  });

  useEffect(() => {
    if (!view.isPending) return;
    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = startedAt;
    const tick = (): void => {
      setView((prev) => {
        if (!prev.isPending) return prev;
        return { ...prev, progress: buildStrategyProgress(Date.now() - startedAt) };
      });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [view.isPending]);

  const activatePdno = (pdno: string): string => {
    activePdnoRef.current = pdno;
    setView((prev) => ({ ...prev, activePdno: pdno }));
    return pdno;
  };

  const open = (options?: OpenStrategyRecommendationOptions): void => {
    if (options) activatePdno(options.pdno);
    setView((prev) => ({ ...prev, isOpen: true }));
  };

  const close = (): void => {
    setView((prev) => ({ ...prev, isOpen: false }));
  };

  const runAnalysis = (options?: OpenStrategyRecommendationOptions): void => {
    if (view.isPending || mut.isPending) {
      open(options);
      return;
    }

    const pdno = options ? activatePdno(options.pdno) : activePdnoRef.current;
    if (!pdno) {
      setView((prev) => ({
        ...prev,
        isOpen: true,
        error: '차수 추천을 실행할 종목이 없습니다.',
      }));
      return;
    }

    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setView((prev) => ({
      ...prev,
      isOpen: true,
      isPending: true,
      activePdno: pdno,
      suggested: null,
      error: null,
      progress: buildStrategyProgress(0),
    }));
    mut.mutate({ pdno });
  };

  const apply = (fallback?: StrategyRecommendationApplyHandler | undefined): void => {
    const suggested = view.suggested;
    const pdno = activePdnoRef.current ?? view.activePdno;
    if (!suggested || !pdno) return;

    const applied: AppliedStrategyRecommendation = {
      id: `${Date.now()}:${pdno}`,
      pdno,
      profile: suggested.profile,
      reasoning: suggested.reasoning,
    };
    setLastApplied(applied);
    fallback?.(suggested.profile, suggested.reasoning);
    const hasActiveConsumer = activeApplyConsumersRef.current.has(pdno);
    toast.success(
      hasActiveConsumer || fallback
        ? 'AI 추천 strategy 가 폼에 적용되었습니다. 저장 버튼으로 확정하세요.'
        : 'AI 추천 strategy 적용을 보관했습니다. 해당 종목의 자동매매 설정 탭을 열면 반영됩니다.',
    );
    setView((prev) => ({
      ...prev,
      isOpen: false,
      suggested: null,
      error: null,
    }));
  };

  const registerApplyConsumer = (pdno: string): (() => void) => {
    activeApplyConsumersRef.current.add(pdno);
    return () => {
      activeApplyConsumersRef.current.delete(pdno);
    };
  };

  const clearLastApplied = (id: string): void => {
    setLastApplied((prev) => (prev?.id === id ? null : prev));
  };

  return {
    view,
    hasDefaultKey,
    isAiListLoading: aiList.isLoading,
    lastApplied,
    open,
    close,
    runAnalysis,
    apply,
    registerApplyConsumer,
    clearLastApplied,
  };
}

export type StrategyRecommendationSession = ReturnType<
  typeof useStrategyRecommendationSessionValue
>;

const StrategyRecommendationSessionContext = createContext<StrategyRecommendationSession | null>(
  null,
);

export interface StrategyRecommendationProviderProps {
  children: ReactNode;
}

export const StrategyRecommendationProvider = ({
  children,
}: StrategyRecommendationProviderProps): ReactElement => {
  const session = useStrategyRecommendationSessionValue();
  return (
    <StrategyRecommendationSessionContext.Provider value={session}>
      {children}
    </StrategyRecommendationSessionContext.Provider>
  );
};

export function useOptionalStrategyRecommendationSession(): StrategyRecommendationSession | null {
  return useContext(StrategyRecommendationSessionContext);
}

export function useStrategyRecommendationSession(): StrategyRecommendationSession {
  const session = useOptionalStrategyRecommendationSession();
  if (!session) {
    throw new Error(
      'StrategyRecommendationProvider 안에서만 AI 차수 추천 세션을 사용할 수 있습니다.',
    );
  }
  return session;
}

/**
 * AI suggestion 을 StrategyProfile 로 병합 — 누락 필드는 DEFAULT 로 보완.
 */
export function mergeIntoProfile(suggestion: {
  maxStages: number;
  buyRules: ReadonlyArray<{ nth: number; triggerDropPct: number | null; amountKrw: number }>;
  sellRules: ReadonlyArray<{ nth: number; targetProfitPct: number }>;
  reasoning: string;
  stageRationales?: unknown;
  globalRisks?: unknown;
  evidenceRefs?: unknown;
  analysisConfidence?: unknown;
  dataQuality?: unknown;
}): StrategyProfile {
  return {
    ...DEFAULT_STRATEGY_PROFILE,
    maxStages: suggestion.maxStages,
    buyRules: suggestion.buyRules.map((r) => ({
      nth: r.nth,
      triggerDropPct: r.nth === 1 ? null : r.triggerDropPct,
      amountKrw: r.amountKrw,
    })),
    sellRules: suggestion.sellRules.map((r) => ({
      nth: r.nth,
      targetProfitPct: r.targetProfitPct,
    })),
  };
}

function buildStrategyProgress(elapsedMs: number): StrategyProgressState {
  const firstStage = STRATEGY_PROGRESS_STAGES[0];
  if (!firstStage) {
    return {
      key: 'prepare',
      percent: 0,
      label: '분석 준비 중',
      detail: '추천 분석을 준비하는 중입니다.',
      elapsedMs,
    };
  }
  let stageIndex = 0;
  for (let i = 0; i < STRATEGY_PROGRESS_STAGES.length; i++) {
    const stage = STRATEGY_PROGRESS_STAGES[i];
    if (stage && elapsedMs >= stage.atMs) stageIndex = i;
  }
  const current = STRATEGY_PROGRESS_STAGES[stageIndex] ?? firstStage;
  const next = STRATEGY_PROGRESS_STAGES[stageIndex + 1];
  let percent = current.percent;

  if (next) {
    const span = Math.max(1, next.atMs - current.atMs);
    const ratio = Math.min(1, Math.max(0, (elapsedMs - current.atMs) / span));
    percent = current.percent + (next.percent - current.percent) * ratio;
  } else {
    const tailRatio = Math.min(1, Math.max(0, (elapsedMs - current.atMs) / 20_000));
    percent = current.percent + (97 - current.percent) * tailRatio;
  }

  return {
    key: current.key,
    percent,
    label: current.label,
    detail: current.detail,
    elapsedMs,
  };
}
