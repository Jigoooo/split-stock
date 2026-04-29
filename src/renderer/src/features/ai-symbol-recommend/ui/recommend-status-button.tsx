import { AlertTriangle, LoaderCircle, Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import { useOptionalSymbolRecommendationSession } from '../model/recommendation-session';

export const RecommendStatusButton = (): ReactElement | null => {
  const session = useOptionalSymbolRecommendationSession();
  if (!session) return null;

  const { open, view } = session;
  const resultCount = view.ranked.length + view.userInputResults.length;
  const hasCompletedState = view.error !== null || view.lastFetchedAt !== null || resultCount > 0;

  if (!view.isPending && !hasCompletedState) return null;

  const percent = Math.round(view.progress?.percent ?? 0);
  const isError = !view.isPending && view.error !== null;
  const label = view.isPending ? '종목 발굴' : isError ? '발굴 오류' : '발굴 결과';
  const detail = view.isPending ? `${percent}%` : `${resultCount}개`;
  const title = view.isPending
    ? '진행 중인 AI 추천 분석 창 열기'
    : isError
      ? 'AI 추천 오류 창 열기'
      : '최근 AI 추천 결과 창 열기';
  const className = [
    'ai-recommend-status',
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
        <Sparkles className="ai-recommend-status__icon" />
      )}
      <span className="ai-recommend-status__label">{label}</span>
      <span className="ai-recommend-status__detail">{detail}</span>
    </button>
  );
};
