// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecommendStrategyButton } from './recommend-strategy-button';

const { mutationOptionsRef, mutateMock } = vi.hoisted(() => ({
  mutationOptionsRef: { current: null as null | { onSuccess: (res: unknown) => void } },
  mutateMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    ai: {
      listConfigs: {
        useQuery: () => ({
          data: { configs: [{ id: 1, isDefault: true }] },
          isLoading: false,
        }),
      },
      suggestStrategy: {
        useMutation: (options: { onSuccess: (res: unknown) => void }) => {
          mutationOptionsRef.current = options;
          return {
            mutate: mutateMock,
            isPending: false,
          };
        },
      },
    },
  },
}));

describe('RecommendStrategyButton', () => {
  beforeEach(() => {
    mutateMock.mockClear();
    mutationOptionsRef.current = null;
  });

  it('does not request strategy analysis until the user clicks the button', () => {
    const onApply = vi.fn();

    render(<RecommendStrategyButton pdno="005930" onApply={onApply} />);

    expect(mutateMock).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천 strategy' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('차수 분석을 시작할 준비');
    expect(mutateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    expect(mutateMock).toHaveBeenCalledWith({ pdno: '005930' });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps the previous strategy result after apply until the user reruns analysis', () => {
    const onApply = vi.fn();

    render(<RecommendStrategyButton pdno="005930" onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천 strategy' }));
    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));

    act(() => {
      mutationOptionsRef.current?.onSuccess({
        suggestion: {
          maxStages: 2,
          buyRules: [
            { nth: 1, triggerDropPct: null, amountKrw: 100_000 },
            { nth: 2, triggerDropPct: 0.03, amountKrw: 120_000 },
          ],
          sellRules: [
            { nth: 1, targetProfitPct: 0.035 },
            { nth: 2, targetProfitPct: 0.025 },
          ],
          reasoning: '박스권 회전성이 있어 2차 운용이 적합합니다.',
          stageRationales: [],
          globalRisks: [],
          evidenceRefs: [],
          analysisConfidence: 'med',
          dataQuality: 'normal',
        },
        dataQuality: 'normal',
      });
    });

    expect(screen.getByText('AI 추천 strategy 상세 (2차)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '폼에 적용' }));

    expect(onApply).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천 strategy' }));

    expect(screen.getByText('AI 추천 strategy 상세 (2차)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 분석' })).toBeInTheDocument();
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });
});
