// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RecommendationDiagnostics,
  RecommendedItem,
  TierDistribution,
} from './use-symbol-recommendations';
import {
  SYMBOL_RECOMMENDATION_CACHE_KEY,
  useSymbolRecommendations,
} from './use-symbol-recommendations';

const { mutationOptionsRef, mutateMock, watchOrdersRef } = vi.hoisted(() => ({
  mutationOptionsRef: {
    current: null as null | { onSuccess: (res: { ranked: RecommendedItem[] }) => void },
  },
  mutateMock: vi.fn(),
  watchOrdersRef: {
    current: [] as Array<{ pdno: string; status: string }>,
  },
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
    watch: {
      list: {
        useQuery: () => ({
          data: { orders: watchOrdersRef.current },
          error: null,
          isPending: false,
        }),
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

const EMPTY_DIST: TierDistribution = { top: 0, strong: 1, moderate: 0, watch: 0, avoid: 0 };

const EMPTY_DIAGNOSTICS: RecommendationDiagnostics = {
  discovery: {
    enabled: true,
    universeCount: 1,
    basisDate: '2026-05-01',
    seedCount: 1,
    candlesFetched: 1,
    candlesFailed: 0,
    candlesSkipped: false,
    screenedCount: 1,
    addedCount: 1,
    blockedCount: 0,
    conditionPassCounts: {
      score: 1,
      volatility: 1,
      range: 1,
      liquidity: 1,
      trendNeutrality: 1,
    },
    tierCounts: EMPTY_DIST,
    lowestIncludedScore: 72,
    emptyReason: null,
    sources: [],
  },
  sources: [],
};

function persistBaseCache(fetchedAt: number): void {
  window.localStorage.setItem(
    SYMBOL_RECOMMENDATION_CACHE_KEY,
    JSON.stringify({
      ranked: [baseItem()],
      userInputResults: [],
      distribution: EMPTY_DIST,
      diagnostics: EMPTY_DIAGNOSTICS,
      emptyReason: null,
      rejectedCount: 0,
      durationMs: 120,
      extras: ['005930'],
      aiOff: true,
      includeAutoDiscovery: false,
      fetchedAt,
    }),
  );
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
      <span data-testid="lastFetchedAt">{session.view.lastFetchedAt ?? 'none'}</span>
      <span data-testid="fromCache">{session.view.fromCache ? 'cache' : 'fresh'}</span>
      <span data-testid="extraPdnos">{session.extraPdnos.join(',')}</span>
      <span data-testid="extraStocks">
        {session.extraStocks.map((stock) => `${stock.name}:${stock.pdno}`).join(',')}
      </span>
      <span data-testid="aiOff">{session.aiOff ? 'off' : 'on'}</span>
      <span data-testid="autoDiscovery">
        {session.includeAutoDiscovery ? 'enabled' : 'disabled'}
      </span>
      <span data-testid="activeWatchPdnos">{[...session.activeWatchPdnos].join(',')}</span>
    </>
  );
}

describe('useSymbolRecommendations', () => {
  beforeEach(() => {
    mutateMock.mockClear();
    mutationOptionsRef.current = null;
    watchOrdersRef.current = [];
    window.localStorage.clear();
  });

  it('restores the last symbol recommendation after renderer restart', () => {
    persistBaseCache(1_777_777_777_000);

    render(<Harness />);

    expect(screen.getByTestId('ranked')).toHaveTextContent('1');
    expect(screen.getByTestId('lastFetchedAt')).toHaveTextContent('1777777777000');
    expect(screen.getByTestId('fromCache')).toHaveTextContent('cache');
    expect(screen.getByTestId('extraPdnos')).toHaveTextContent('005930');
    expect(screen.getByTestId('extraStocks')).toHaveTextContent('005930:005930');
    expect(screen.getByTestId('aiOff')).toHaveTextContent('off');
    expect(screen.getByTestId('autoDiscovery')).toHaveTextContent('disabled');
  });

  it('active watch pdno 목록은 WATCHING/PAUSED 자동감시만 포함한다', () => {
    watchOrdersRef.current = [
      { pdno: '005930', status: 'WATCHING' },
      { pdno: '000660', status: 'PAUSED' },
      { pdno: '035420', status: 'EXECUTED' },
    ];

    render(<Harness />);

    expect(screen.getByTestId('activeWatchPdnos')).toHaveTextContent('005930,000660');
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
    const persisted = JSON.parse(
      window.localStorage.getItem(SYMBOL_RECOMMENDATION_CACHE_KEY) ?? '{}',
    ) as { ranked?: Array<{ pdno?: string }> };
    expect(persisted.ranked?.[0]?.pdno).toBe('005930');

    act(() => {
      screen.getByRole('button', { name: 'ai off' }).click();
      screen.getByRole('button', { name: 'open' }).click();
    });

    expect(screen.getByTestId('open')).toHaveTextContent('open');
    expect(screen.getByTestId('ranked')).toHaveTextContent('1');
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });
});
