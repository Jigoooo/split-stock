import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@shared/contracts';
import { Sparkles } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { toast } from 'sonner';

export interface RecommendStrategyButtonProps {
  pdno: string;
  /** 사용자 승인 후 폼에 적용 — initialOverride 로 흘려보내기. */
  onApply: (profile: StrategyProfile, reasoning: string) => void;
  dense?: boolean;
}

interface SuggestedView {
  profile: StrategyProfile;
  reasoning: string;
}

export const RecommendStrategyButton = ({
  pdno,
  onApply,
  dense,
}: RecommendStrategyButtonProps): ReactElement => {
  const aiList = trpc.ai.listConfigs.useQuery();
  const hasDefault = (aiList.data?.configs ?? []).some((c) => c.isDefault);
  const [suggested, setSuggested] = useState<SuggestedView | null>(null);

  const mut = trpc.ai.suggestStrategy.useMutation({
    onSuccess: (res) => {
      if (!res.suggestion) {
        toast.error(res.emptyReason ?? 'AI 추천 결과가 없습니다');
        return;
      }
      const profile = mergeIntoProfile(res.suggestion);
      setSuggested({ profile, reasoning: res.suggestion.reasoning });
    },
    onError: (err) => {
      toast.error(`AI strategy 추천 실패: ${err.message}`);
    },
  });

  const disabled = aiList.isLoading || !hasDefault || mut.isPending;
  const title = !hasDefault
    ? '설정 → AI 탭에서 키를 등록하고 기본으로 지정하세요'
    : 'AI 가 종목 통계+공시를 분석해 차수 / 익절률 / 매수금액 추천';

  const handleClick = (): void => {
    setSuggested(null);
    mut.mutate({ pdno });
  };

  const handleApply = (): void => {
    if (!suggested) return;
    onApply(suggested.profile, suggested.reasoning);
    toast.success('AI 추천 strategy 가 폼에 적용되었습니다. 저장 버튼으로 확정하세요.');
    setSuggested(null);
  };

  const handleDismiss = (): void => setSuggested(null);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <Button
        variant="ghost"
        dense={dense ?? false}
        iconLeading={<Sparkles size={14} />}
        disabled={disabled}
        onClick={handleClick}
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
      {suggested ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.4rem 0.8rem',
            border: '0.1rem solid #D97757',
            borderRadius: '0.4rem',
            backgroundColor: 'rgba(217, 119, 87, 0.08)',
            fontSize: '1.1rem',
            color: 'var(--fg)',
          }}
        >
          <span title={suggested.reasoning}>
            {suggested.profile.maxStages}차 / 첫 매수{' '}
            {suggested.profile.buyRules[0]?.amountKrw.toLocaleString() ?? '?'}원
          </span>
          <Button variant="primary" dense onClick={handleApply}>
            적용
          </Button>
          <Button variant="ghost" dense onClick={handleDismiss}>
            취소
          </Button>
        </span>
      ) : null}
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
