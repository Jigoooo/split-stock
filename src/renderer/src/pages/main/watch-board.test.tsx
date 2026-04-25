// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchBoard } from './ui/watch-board';

const { storeAddWatchOrderPrefillMock } = vi.hoisted(() => ({
  storeAddWatchOrderPrefillMock: vi.fn(),
}));

vi.mock('@renderer/entities/watch-order', () => ({
  useWatchOrders: () => ({
    orders: [],
    isPending: false,
    error: null,
  }),
  useWatchHistory: () => ({
    items: [],
    isPending: false,
    error: null,
  }),
}));

vi.mock('@renderer/features/add-watch-order', () => ({
  storeAddWatchOrderPrefill: storeAddWatchOrderPrefillMock,
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      watch: {
        list: { invalidate: vi.fn() },
        getControlState: { invalidate: vi.fn() },
        history: { invalidate: vi.fn() },
      },
    }),
    watch: {
      cancel: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      pause: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setGlobalEnabled: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ai: {
      listConfigs: { useQuery: () => ({ data: { configs: [] }, isLoading: false }) },
      suggestSymbols: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

describe('WatchBoard', () => {
  it('4탭 렌더링 (현황/실행내역/실패/히스토리)', () => {
    render(<WatchBoard accountId={1} />);

    expect(screen.getByRole('tab', { name: '현황' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '실행내역' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '실패' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '히스토리' })).toBeInTheDocument();

    // 초기 탭은 '현황' active
    expect(screen.getByRole('tab', { name: '현황' })).toHaveAttribute('aria-selected', 'true');
  });

  it('추가 버튼 클릭 시 prefill을 저장하고 add-watch-order 팝아웃을 연다', () => {
    const openPopout = vi.fn().mockResolvedValue({ ok: true });
    window.appShell = {
      openPopout,
      onPopoutClosed: vi.fn(() => () => {}),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => () => {}),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => () => {}),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => () => {}),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
    };

    render(<WatchBoard accountId={7} />);
    fireEvent.click(screen.getByRole('button', { name: '+ 추가' }));

    expect(storeAddWatchOrderPrefillMock).toHaveBeenCalledWith({
      accountId: 7,
      prefill: null,
    });
    expect(openPopout).toHaveBeenCalledWith('add-watch-order');
  });
});
