// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TradeHistoryPanel } from './ui/trade-history-panel';

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    account: {
      getActive: {
        useQuery: () => ({ data: { accountId: 1, account: null }, isPending: false }),
      },
    },
    lots: {
      cyclesByPdno: {
        useQuery: () => ({ data: { cycles: [] }, isPending: false, error: null }),
      },
    },
    protection: {
      get: {
        useQuery: () => ({ data: { limits: null }, isPending: false, error: null }),
      },
      set: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    tradingWindows: {
      list: {
        useQuery: () => ({ data: { windows: [] }, isPending: false, error: null }),
      },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    rateGuard: {
      getSettings: {
        useQuery: () => ({
          data: { enabled: false, windowSeconds: 40, maxCount: 5 },
          isPending: false,
          error: null,
        }),
      },
      updateSettings: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    strategy: {
      get: {
        useQuery: () => ({ data: null, isPending: false, error: null }),
      },
      set: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    symbolMemo: {
      get: {
        useQuery: () => ({ data: { memo: '' }, isPending: false, error: null }),
      },
      set: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      protection: { get: { invalidate: vi.fn() } },
      tradingWindows: { list: { invalidate: vi.fn() } },
      rateGuard: { getSettings: { invalidate: vi.fn() } },
      lots: { cyclesByPdno: { invalidate: vi.fn() } },
    }),
  },
}));

describe('TradeHistoryPanel', () => {
  it('5탭 렌더링', () => {
    render(<TradeHistoryPanel accountId={1} pdno={null} />);

    expect(screen.getByRole('tab', { name: '전체보기' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '진행중' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '종료' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '자동매매 설정' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '종목메모' })).toBeInTheDocument();
  });

  it('탭 변경 시 컨텐츠 swap — 진행중 탭 클릭', () => {
    render(<TradeHistoryPanel accountId={1} pdno={null} />);

    expect(screen.getByRole('tab', { name: '전체보기' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: '진행중' }));

    expect(screen.getByRole('tab', { name: '진행중' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '전체보기' })).toHaveAttribute('aria-selected', 'false');
  });
});
