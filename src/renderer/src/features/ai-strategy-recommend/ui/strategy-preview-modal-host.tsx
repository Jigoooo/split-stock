import type { ReactElement } from 'react';
import { useOptionalStrategyRecommendationSession } from '../model/strategy-recommendation-session';
import { StrategyPreviewModal } from './strategy-preview-modal';

export const StrategyPreviewModalHost = (): ReactElement | null => {
  const session = useOptionalStrategyRecommendationSession();
  if (!session) return null;

  return (
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
      onApply={() => session.apply()}
      onDismiss={session.close}
      onRetry={() => session.runAnalysis()}
    />
  );
};
