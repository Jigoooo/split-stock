import type { ReactElement } from 'react';
import {
  type RecommendationPickHandler,
  useOptionalSymbolRecommendationSession,
} from '../model/recommendation-session';
import { RecommendModal } from './recommend-modal';

export interface RecommendModalHostProps {
  onPick?: RecommendationPickHandler | undefined;
}

export const RecommendModalHost = ({ onPick }: RecommendModalHostProps): ReactElement | null => {
  const session = useOptionalSymbolRecommendationSession();
  if (!session) return null;

  return (
    <RecommendModal
      view={session.view}
      onClose={session.close}
      onAnalyze={session.analyze}
      onPick={(pdno, name) => session.pick(pdno, name, onPick)}
      activeWatchPdnos={session.activeWatchPdnos}
      extras={session.extraStocks}
      onAddExtra={session.addExtraStock}
      onRemoveExtra={session.removeExtraPdno}
      aiOff={session.aiOff}
      onToggleAiOff={session.toggleAiOff}
      includeAutoDiscovery={session.includeAutoDiscovery}
      onToggleAutoDiscovery={session.toggleAutoDiscovery}
      hasDefaultKey={session.hasDefaultKey}
    />
  );
};
