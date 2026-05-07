import { Button } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import { Eye, Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import {
  type StrategyRecommendationSession,
  useOptionalStrategyRecommendationSession,
  useStrategyRecommendationSessionValue,
} from '../model/strategy-recommendation-session';
import { StrategyPreviewModal } from './strategy-preview-modal';

export interface RecommendStrategyButtonProps {
  pdno: string;
  /** 사용자 승인 후 폼에 적용 — initialOverride 로 흘려보내기. */
  onApply: (profile: StrategyProfile, reasoning: string) => void;
  dense?: boolean;
  broker?: string;
}

export const RecommendStrategyButton = (props: RecommendStrategyButtonProps): ReactElement => {
  if (props.broker === 'UPBIT') {
    return <CryptoUnsupportedStrategyButton dense={props.dense ?? false} />;
  }
  return <DomesticRecommendStrategyButton {...props} />;
};

const CryptoUnsupportedStrategyButton = ({ dense }: { dense: boolean }): ReactElement => (
  <Button
    variant="ghost"
    dense={dense}
    iconLeading={<Sparkles size={14} />}
    disabled
    title="코인 strategy 추천 미지원"
    aria-label="AI 추천 strategy (미지원)"
    style={{
      color: '#D97757',
      borderColor: '#D97757',
      borderStyle: 'solid',
      borderWidth: '0.1rem',
    }}
  >
    AI 추천
  </Button>
);

const DomesticRecommendStrategyButton = (props: RecommendStrategyButtonProps): ReactElement => {
  const session = useOptionalStrategyRecommendationSession();

  if (session) {
    return <RecommendStrategyButtonTrigger {...props} session={session} />;
  }

  return <StandaloneRecommendStrategyButton {...props} />;
};

const StandaloneRecommendStrategyButton = (props: RecommendStrategyButtonProps): ReactElement => {
  const session = useStrategyRecommendationSessionValue();

  return (
    <>
      <RecommendStrategyButtonTrigger {...props} session={session} />
      <StrategyPreviewModal
        open={session.view.isOpen}
        profile={session.view.suggested?.profile ?? null}
        reasoning={session.view.suggested?.reasoning ?? ''}
        stageRationales={session.view.suggested?.stageRationales ?? []}
        globalRisks={session.view.suggested?.globalRisks ?? []}
        evidenceRefs={session.view.suggested?.evidenceRefs ?? []}
        analysisConfidence={session.view.suggested?.analysisConfidence ?? 'low'}
        dataQuality={session.view.suggested?.dataQuality ?? 'blocked'}
        dataQualityReason={session.view.suggested?.dataQualityReason}
        error={session.view.error}
        isPending={session.view.isPending}
        progress={session.view.progress}
        onApply={() => session.apply(props.onApply)}
        onDismiss={session.close}
        onRetry={() => session.runAnalysis({ pdno: props.pdno })}
      />
    </>
  );
};

interface RecommendStrategyButtonTriggerProps extends RecommendStrategyButtonProps {
  session: StrategyRecommendationSession;
}

const RecommendStrategyButtonTrigger = ({
  dense,
  pdno,
  session,
}: RecommendStrategyButtonTriggerProps): ReactElement => {
  const disabled = session.isAiListLoading || !session.hasDefaultKey || session.view.isPending;
  const title = !session.hasDefaultKey
    ? '설정 → AI 탭에서 키를 등록하고 기본으로 지정하세요'
    : 'AI 가 종목 통계+공시를 분석해 차수 / 익절률 / 매수금액 추천';
  const isActivePdno = session.view.activePdno === pdno;
  const hasPreview = isActivePdno && session.view.suggested !== null;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <Button
        variant="ghost"
        dense={dense ?? false}
        iconLeading={<Sparkles size={14} />}
        disabled={disabled}
        onClick={() => session.open({ pdno })}
        title={title}
        aria-label="AI 추천 strategy"
        style={{
          color: '#D97757',
          borderColor: '#D97757',
          borderStyle: 'solid',
          borderWidth: '0.1rem',
        }}
      >
        {isActivePdno && session.view.isPending ? '분석 중...' : 'AI 추천'}
      </Button>
      {hasPreview && !session.view.isOpen ? (
        <Button
          variant="ghost"
          dense
          iconLeading={<Eye size={14} />}
          onClick={() => session.open({ pdno })}
          title={session.view.suggested?.reasoning}
          style={{
            color: '#D97757',
            borderColor: '#D97757',
            borderStyle: 'solid',
            borderWidth: '0.1rem',
          }}
        >
          {session.view.suggested?.profile.maxStages}차 추천 · 상세 보기
        </Button>
      ) : null}
    </div>
  );
};
