import { Button } from '@renderer/shared/ui';
import { Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import {
  type SymbolRecommendationSession,
  useOptionalSymbolRecommendationSession,
} from '../model/recommendation-session';
import { useSymbolRecommendations } from '../model/use-symbol-recommendations';
import { RecommendModal } from './recommend-modal';

export interface RecommendButtonProps {
  /** 추천 결과 카드 클릭 시 호출 — 외부 폼 prefill 용. */
  onPick?: (pdno: string, name: string) => void;
  /** 라벨 변경. 기본 'AI 박스권 분할매매 추천'. */
  label?: string;
  dense?: boolean;
}

/**
 * 자동감시 첫 플로우(종목 선택)를 보조하는 AI 추천 트리거.
 * - default AI 키 미설정 시 disabled + 안내 툴팁.
 * - 클릭 시 modal 오픈, mutation 자동 트리거.
 */
export const RecommendButton = (props: RecommendButtonProps): ReactElement => {
  const session = useOptionalSymbolRecommendationSession();

  if (session) {
    return <RecommendButtonTrigger {...props} session={session} />;
  }

  return <StandaloneRecommendButton {...props} />;
};

const StandaloneRecommendButton = (props: RecommendButtonProps): ReactElement => {
  const session = useSymbolRecommendations();

  return (
    <>
      <RecommendButtonTrigger {...props} session={session} />
      <RecommendModal
        view={session.view}
        onClose={session.close}
        onAnalyze={session.analyze}
        onPick={(pdno, name) => session.pick(pdno, name, props.onPick)}
        extras={session.extraPdnos}
        onAddExtra={session.addExtraPdno}
        onRemoveExtra={session.removeExtraPdno}
        aiOff={session.aiOff}
        onToggleAiOff={session.toggleAiOff}
        includeAutoDiscovery={session.includeAutoDiscovery}
        onToggleAutoDiscovery={session.toggleAutoDiscovery}
        hasDefaultKey={session.hasDefaultKey}
      />
    </>
  );
};

interface RecommendButtonTriggerProps extends RecommendButtonProps {
  session: SymbolRecommendationSession;
}

const RecommendButtonTrigger = ({
  onPick,
  label,
  dense,
  session,
}: RecommendButtonTriggerProps): ReactElement => {
  const { hasDefaultKey, isAiListLoading, open } = session;

  const disabled = isAiListLoading;
  const title = !hasDefaultKey
    ? 'AI 키 미등록 — 알고리즘 전용 모드로 추천. 설정 → AI 탭에서 키를 등록하면 LLM 활용.'
    : 'AI 또는 알고리즘으로 박스권 분할매매 적합 종목 추천 (top/strong/moderate/watch/avoid 분포)';
  const handleClick = (): void => open({ onPick });

  return (
    <Button
      variant="ghost"
      dense={dense ?? false}
      iconLeading={<Sparkles size={14} />}
      disabled={disabled}
      onClick={handleClick}
      title={title}
      aria-label="AI 박스권 분할매매 추천"
      style={{
        color: '#D97757',
        borderColor: '#D97757',
        borderStyle: 'solid',
        borderWidth: '0.1rem',
      }}
    >
      {label ?? 'AI 추천'}
    </Button>
  );
};
