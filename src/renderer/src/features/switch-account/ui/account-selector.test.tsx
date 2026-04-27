// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSelector } from './account-selector';

const useQueryMock = vi.fn();
const useStoredQueryMock = vi.fn();
const useDeleteMutationMock = vi.fn();
const useRenameMutationMock = vi.fn();
const useReorderMutationMock = vi.fn();
const useSwitchAccountMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    account: {
      listAccounts: {
        useQuery: (...args: unknown[]) => useQueryMock(...args),
      },
      delete: {
        useMutation: (...args: unknown[]) => useDeleteMutationMock(...args),
      },
      rename: {
        useMutation: (...args: unknown[]) => useRenameMutationMock(...args),
      },
      reorder: {
        useMutation: (...args: unknown[]) => useReorderMutationMock(...args),
      },
    },
    auth: {
      listStored: {
        useQuery: (...args: unknown[]) => useStoredQueryMock(...args),
      },
    },
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
  };
});

vi.mock('../model/use-switch-account', () => ({
  useSwitchAccount: () => useSwitchAccountMock(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('AccountSelector', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useStoredQueryMock.mockReset();
    useDeleteMutationMock.mockReset();
    useRenameMutationMock.mockReset();
    useReorderMutationMock.mockReset();
    useSwitchAccountMock.mockReset();
    invalidateQueriesMock.mockReset();

    useQueryMock.mockReturnValue({
      data: {
        accounts: [
          {
            id: 1,
            env: 'MOCK',
            broker: 'KIS',
            accountNo8: '12345678',
            displayName: '모의 계좌',
            isActive: true,
          },
          {
            id: 2,
            env: 'PROD',
            broker: 'KIS',
            accountNo8: '87654321',
            displayName: '실전 계좌',
            isActive: false,
          },
        ],
        activeAccountId: 1,
      },
      error: null,
      isPending: false,
    });
    useStoredQueryMock.mockReturnValue({
      data: { entries: [] },
      error: null,
      isPending: false,
    });
    useDeleteMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useRenameMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useReorderMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useSwitchAccountMock.mockReturnValue({
      error: null,
      isPending: false,
      switchAccount: vi.fn(),
    });

    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn(() => () => undefined),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => () => undefined),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => () => undefined),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => () => undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('바깥 pointerdown 시 열린 계좌 목록을 닫는다', async () => {
    render(
      <div>
        <AccountSelector />
        <button type="button">outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /모의 계좌 · mock 5678/i }));

    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: '계좌 목록' })).toBeInTheDocument();
    });

    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: '계좌 목록' })).not.toBeInTheDocument();
    });
  });

  it('목록 내부 pointerdown 은 닫힘으로 처리하지 않는다', async () => {
    render(<AccountSelector />);

    fireEvent.click(screen.getByRole('button', { name: /모의 계좌 · mock 5678/i }));

    const listbox = await screen.findByRole('listbox', { name: '계좌 목록' });
    fireEvent.pointerDown(listbox);

    expect(screen.getByRole('listbox', { name: '계좌 목록' })).toBeInTheDocument();
  });

  it('계좌 목록이 비어도 저장된 자격증명을 fallback 옵션으로 보여준다', async () => {
    useQueryMock.mockReturnValue({
      data: { accounts: [], activeAccountId: 7 },
      error: null,
      isPending: false,
    });
    useStoredQueryMock.mockReturnValue({
      data: {
        entries: [{ accountId: 7, env: 'MOCK', broker: 'KIS', accountNo8: '12345678' }],
      },
      error: null,
      isPending: false,
    });

    render(<AccountSelector />);

    fireEvent.click(screen.getByRole('button', { name: /\[KIS\] MOCK · 5678/i }));

    expect(await screen.findByRole('listbox', { name: '계좌 목록' })).toBeInTheDocument();
    expect(screen.getAllByText('[KIS] MOCK · 5678')).toHaveLength(2);
  });
});
