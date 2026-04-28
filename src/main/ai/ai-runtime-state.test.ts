import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAiRuntimeStatus,
  resetAiRuntimeStateForTest,
  runWithAiRuntimeOperation,
} from './ai-runtime-state';

describe('ai-runtime-state', () => {
  beforeEach(() => {
    resetAiRuntimeStateForTest();
  });

  it('AI 작업 실행 중에는 config lock 상태를 노출하고 완료 후 해제한다', async () => {
    let release!: (value: string) => void;
    const pending = runWithAiRuntimeOperation(
      'symbolRecommendation',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    expect(getAiRuntimeStatus()).toEqual({
      isConfigLocked: true,
      activeOperations: { symbolRecommendation: 1, strategyRecommendation: 0 },
    });

    release('ok');
    await expect(pending).resolves.toBe('ok');
    expect(getAiRuntimeStatus().isConfigLocked).toBe(false);
  });

  it('AI 작업이 실패해도 config lock 을 해제한다', async () => {
    await expect(
      runWithAiRuntimeOperation('strategyRecommendation', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(getAiRuntimeStatus()).toEqual({
      isConfigLocked: false,
      activeOperations: { symbolRecommendation: 0, strategyRecommendation: 0 },
    });
  });
});
