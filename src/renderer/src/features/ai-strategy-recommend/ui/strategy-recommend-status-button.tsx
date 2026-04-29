import { AlertTriangle, Layers3, LoaderCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useOptionalStrategyRecommendationSession } from '../model/strategy-recommendation-session';

export const StrategyRecommendStatusButton = (): ReactElement | null => {
  const session = useOptionalStrategyRecommendationSession();
  if (!session) return null;

  const { open, view } = session;
  const hasCompletedState = view.error !== null || view.suggested !== null;

  if (!view.isPending && !hasCompletedState) return null;

  const percent = Math.round(view.progress?.percent ?? 0);
  const isError = !view.isPending && view.error !== null;
  const label = view.isPending ? '차수 설계' : isError ? '차수 오류' : '차수 결과';
  const detail = view.isPending
    ? `${percent}%`
    : view.suggested
      ? `${view.suggested.profile.maxStages}차`
      : (view.activePdno ?? '확인');
  const title = view.isPending
    ? '진행 중인 AI 차수 추천 창 열기'
    : isError
      ? 'AI 차수 추천 오류 창 열기'
      : '최근 AI 차수 추천 결과 창 열기';
  const className = [
    'ai-recommend-status',
    'ai-recommend-status--strategy',
    view.isPending ? 'ai-recommend-status--pending' : '',
    isError ? 'ai-recommend-status--error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={() => open()}
      title={title}
      aria-label={title}
    >
      {view.isPending ? (
        <LoaderCircle className="ai-recommend-status__icon ai-recommend-status__icon--spin" />
      ) : isError ? (
        <AlertTriangle className="ai-recommend-status__icon" />
      ) : (
        <Layers3 className="ai-recommend-status__icon" />
      )}
      <span className="ai-recommend-status__label">{label}</span>
      <span className="ai-recommend-status__detail">{detail}</span>
    </button>
  );
};
