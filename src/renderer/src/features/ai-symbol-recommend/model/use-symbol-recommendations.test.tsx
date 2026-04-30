// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedItem } from './use-symbol-recommendations';
import { useSymbolRecommendations } from './use-symbol-recommendations';

const { mutationOptionsRef, mutateMock } = vi.hoisted(() => ({
  mutationOptionsRef: {
    current: null as null | { onSuccess: (res: { ranked: RecommendedItem[] }) => void },
  },
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
      suggestSymbols: {
        useMutation: (options: { onSuccess: (res: { ranked: RecommendedItem[] }) => void }) => {
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

function baseItem(): RecommendedItem {
  return {
    pdno: '005930',
    name: '삼성전자',
    score: 72,
    tier: 'strong',
    confidence: 'med',
    volatilityFit: 'mid',
    liquidityFit: 'good',
    summary: '알고리즘 신호와 뉴스가 중립 이상입니다.',
    pros: [],
    cons: [],
    entryNote: null,
    consensusCount: 3,
    citedTools: [],
    sources: ['AUTO'],
    stats: {
      lastClose: 72100,
      volatility60d: 18.2,
      avgVolume60d: 12000000,
      rangePct120d: 24.5,
    },
    marketContext: null,
    algoScore: 74,
    algoLabels: [],
    aiOff: false,
    news: [],
    conflicts: [],
    indicatorReasons: [],
  };
}

function Harness(): ReactElement {
  const session = useSymbolRecommendations();
  return (
    <>
      <button type="button" onClick={() => session.open()}>
        open
      </button>
      <button type="button" onClick={() => session.analyze()}>
        analyze
      </button>
      <button type="button" onClick={() => session.toggleAiOff(true)}>
        ai off
      </button>
      <span data-testid="open">{session.view.isOpen ? 'open' : 'closed'}</span>
      <span data-testid="ranked">{session.view.ranked.length}</span>
      <span data-testid="pending">{session.view.isPending ? 'pending' : 'idle'}</span>
    </>
  );
}

describe('useSymbolRecommendations', () => {
  beforeEach(() => {
    mutateMock.mockClear();
    mutationOptionsRef.current = null;
  });

  it('keeps the previous symbol result when options change until the user reruns analysis', () => {
    render(<Harness />);

    act(() => {
      screen.getByRole('button', { name: 'analyze' }).click();
    });

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pending')).toHaveTextContent('pending');

    act(() => {
      mutationOptionsRef.current?.onSuccess({
        ranked: [baseItem()],
      });
    });

    expect(screen.getByTestId('ranked')).toHaveTextContent('1');

    act(() => {
      screen.getByRole('button', { name: 'ai off' }).click();
      screen.getByRole('button', { name: 'open' }).click();
    });

    expect(screen.getByTestId('open')).toHaveTextContent('open');
    expect(screen.getByTestId('ranked')).toHaveTextContent('1');
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });
});
