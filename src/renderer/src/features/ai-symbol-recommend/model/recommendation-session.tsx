import { createContext, type ReactElement, type ReactNode, useContext } from 'react';
import { useSymbolRecommendations } from './use-symbol-recommendations';

export type SymbolRecommendationSession = ReturnType<typeof useSymbolRecommendations>;
export type { RecommendationPickHandler } from './use-symbol-recommendations';

const SymbolRecommendationSessionContext = createContext<SymbolRecommendationSession | null>(null);

export interface SymbolRecommendationProviderProps {
  children: ReactNode;
}

export const SymbolRecommendationProvider = ({
  children,
}: SymbolRecommendationProviderProps): ReactElement => {
  const session = useSymbolRecommendations();

  return (
    <SymbolRecommendationSessionContext.Provider value={session}>
      {children}
    </SymbolRecommendationSessionContext.Provider>
  );
};

export function useOptionalSymbolRecommendationSession(): SymbolRecommendationSession | null {
  return useContext(SymbolRecommendationSessionContext);
}

export function useSymbolRecommendationSession(): SymbolRecommendationSession {
  const session = useOptionalSymbolRecommendationSession();
  if (!session) {
    throw new Error('SymbolRecommendationProvider 안에서만 AI 추천 세션을 사용할 수 있습니다.');
  }
  return session;
}
