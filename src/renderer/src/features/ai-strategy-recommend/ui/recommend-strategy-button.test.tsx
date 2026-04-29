// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecommendStrategyButton } from './recommend-strategy-button';

const { mutateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
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
        useMutation: () => ({
          mutate: mutateMock,
          isPending: false,
        }),
      },
    },
  },
}));

describe('RecommendStrategyButton', () => {
  it('does not request strategy analysis until the user clicks the button', () => {
    const onApply = vi.fn();

    render(<RecommendStrategyButton pdno="005930" onApply={onApply} />);

    expect(mutateMock).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천 strategy' }));

    expect(mutateMock).toHaveBeenCalledWith({ pdno: '005930' });
    expect(onApply).not.toHaveBeenCalled();
  });
});
