import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@shared/contracts';
import { Eye, Sparkles } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { StrategyPreviewModal } from './strategy-preview-modal';

export interface RecommendStrategyButtonProps {
  pdno: string;
  /** 사용자 승인 후 폼에 적용 — initialOverride 로 흘려보내기. */
  onApply: (profile: StrategyProfile, reasoning: string) => void;
  dense?: boolean;
}

interface SuggestedView {
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
    label: '시장 컨텍스트 반영 중',
    detail: 'KRX/ECOS 캐시와 시장 상태를 추천 근거에 붙이는 중입니다.',
  },
  {
    key: 'evidence',
    atMs: 7_500,
    percent: 58,
    label: '뉴스와 공시 근거 수집 중',
    detail: '최근 뉴스와 DART 공시를 요약해 차수별 근거로 압축하는 중입니다.',
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

export const RecommendStrategyButton = ({
  pdno,
  onApply,
  dense,
}: RecommendStrategyButtonProps): ReactElement => {
  const aiList = trpc.ai.listConfigs.useQuery();
  const hasDefault = (aiList.data?.configs ?? []).some((c) => c.isDefault);
  const [suggested, setSuggested] = useState<SuggestedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [progress, setProgress] = useState<StrategyProgressState | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const mut = trpc.ai.suggestStrategy.useMutation({
    onSuccess: (res) => {
      startedAtRef.current = null;
      setProgress(null);
      if (!res.suggestion) {
        setSuggested(null);
        setError(res.emptyReason ?? 'AI 추천 결과가 없습니다.');
        setPreviewOpen(true);
        return;
      }
      const profile = mergeIntoProfile(res.suggestion);
      setError(null);
      setSuggested({
        profile,
        reasoning: res.suggestion.reasoning,
        stageRationales: res.suggestion.stageRationales ?? [],
        globalRisks: res.suggestion.globalRisks ?? [],
        evidenceRefs: res.suggestion.evidenceRefs ?? [],
        analysisConfidence: res.suggestion.analysisConfidence ?? 'low',
        dataQuality: res.suggestion.dataQuality ?? res.dataQuality ?? 'blocked',
        dataQualityReason: res.dataQualityReason,
      });
      setPreviewOpen(true);
    },
    onError: (err) => {
      startedAtRef.current = null;
      setProgress(null);
      setSuggested(null);
      setError(`AI strategy 추천 실패: ${err.message}`);
      setPreviewOpen(true);
    },
  });

  useEffect(() => {
    if (!mut.isPending) return;
    const startedAt = startedAtRef.current ?? Date.now();
    startedAtRef.current = startedAt;
    const tick = (): void => {
      setProgress(buildStrategyProgress(Date.now() - startedAt));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [mut.isPending]);

  const disabled = aiList.isLoading || !hasDefault || mut.isPending;
  const title = !hasDefault
    ? '설정 → AI 탭에서 키를 등록하고 기본으로 지정하세요'
    : 'AI 가 종목 통계+공시를 분석해 차수 / 익절률 / 매수금액 추천';

  const openPreview = (): void => {
    setSuggested(null);
    setError(null);
    setPreviewOpen(true);
  };

  const runAnalysis = (): void => {
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    setSuggested(null);
    setError(null);
    setProgress(buildStrategyProgress(0));
    setPreviewOpen(true);
    mut.mutate({ pdno });
  };

  const handleApply = (): void => {
    if (!suggested) return;
    onApply(suggested.profile, suggested.reasoning);
    toast.success('AI 추천 strategy 가 폼에 적용되었습니다. 저장 버튼으로 확정하세요.');
    setSuggested(null);
    setError(null);
    setPreviewOpen(false);
  };

  const handleDismiss = (): void => {
    setPreviewOpen(false);
  };

  const handleReopenPreview = (): void => {
    if (suggested) setPreviewOpen(true);
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <Button
        variant="ghost"
        dense={dense ?? false}
        iconLeading={<Sparkles size={14} />}
        disabled={disabled}
        onClick={openPreview}
        title={title}
        aria-label="AI 추천 strategy"
        style={{
          color: '#D97757',
          borderColor: '#D97757',
          borderStyle: 'solid',
          borderWidth: '0.1rem',
        }}
      >
        {mut.isPending ? '분석 중...' : 'AI 추천'}
      </Button>
      {suggested && !previewOpen ? (
        <Button
          variant="ghost"
          dense
          iconLeading={<Eye size={14} />}
          onClick={handleReopenPreview}
          title={suggested.reasoning}
          style={{
            color: '#D97757',
            borderColor: '#D97757',
            borderStyle: 'solid',
            borderWidth: '0.1rem',
          }}
        >
          {suggested.profile.maxStages}차 추천 · 상세 보기
        </Button>
      ) : null}
      <StrategyPreviewModal
        open={previewOpen}
        profile={suggested?.profile ?? null}
        reasoning={suggested?.reasoning ?? ''}
        stageRationales={suggested?.stageRationales ?? []}
        globalRisks={suggested?.globalRisks ?? []}
        evidenceRefs={suggested?.evidenceRefs ?? []}
        analysisConfidence={suggested?.analysisConfidence ?? 'low'}
        dataQuality={suggested?.dataQuality ?? 'blocked'}
        dataQualityReason={suggested?.dataQualityReason}
        error={error}
        isPending={mut.isPending}
        progress={progress}
        onApply={handleApply}
        onDismiss={handleDismiss}
        onRetry={runAnalysis}
      />
    </div>
  );
};

/**
 * AI suggestion 을 StrategyProfile 로 병합 — 누락 필드는 DEFAULT 로 보완.
 */
function mergeIntoProfile(suggestion: {
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
