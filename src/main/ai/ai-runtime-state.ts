export type AiRuntimeOperation = 'symbolRecommendation' | 'strategyRecommendation';

export interface AiRuntimeStatus {
  isConfigLocked: boolean;
  activeOperations: Record<AiRuntimeOperation, number>;
}

const activeOperations: Record<AiRuntimeOperation, number> = {
  symbolRecommendation: 0,
  strategyRecommendation: 0,
};

export function getAiRuntimeStatus(): AiRuntimeStatus {
  return {
    isConfigLocked: Object.values(activeOperations).some((count) => count > 0),
    activeOperations: { ...activeOperations },
  };
}

export async function runWithAiRuntimeOperation<T>(
  operation: AiRuntimeOperation,
  run: () => Promise<T>,
): Promise<T> {
  activeOperations[operation]++;
  try {
    return await run();
  } finally {
    activeOperations[operation] = Math.max(0, activeOperations[operation] - 1);
  }
}

export function resetAiRuntimeStateForTest(): void {
  activeOperations.symbolRecommendation = 0;
  activeOperations.strategyRecommendation = 0;
}
