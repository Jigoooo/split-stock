// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppShell } from './use-app-shell';

const getEnvUseQuery = vi.fn();
const listStoredUseQuery = vi.fn();
const listAccountsUseQuery = vi.fn();
const getActiveUseQuery = vi.fn();
const setEnvUseMutation = vi.fn();
const logEnvSwitchCancelledUseMutation = vi.fn();
const invalidate = vi.fn();
const invalidateEnv = vi.fn();
const cancelQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ cancelQueries }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    auth: {
      getEnv: { useQuery: () => getEnvUseQuery() },
      listStored: { useQuery: () => listStoredUseQuery() },
      setEnv: { useMutation: (options: unknown) => setEnvUseMutation(options) },
      logEnvSwitchCancelled: {
        useMutation: () => logEnvSwitchCancelledUseMutation(),
      },
    },
    account: {
      listAccounts: { useQuery: () => listAccountsUseQuery() },
      getActive: {
        useQuery: (input: unknown, options: unknown) => getActiveUseQuery(input, options),
      },
    },
    useUtils: () => ({
      invalidate,
      auth: { getEnv: { invalidate: invalidateEnv } },
    }),
  },
}));

describe('useAppShell', () => {
  beforeEach(() => {
    getEnvUseQuery.mockReturnValue({ data: { env: 'MOCK' }, isPending: false });
    listStoredUseQuery.mockReturnValue({
      data: { entries: [{ env: 'MOCK', accountNo8: '12345678' }] },
      isPending: false,
    });
    listAccountsUseQuery.mockReturnValue({ data: { accounts: [] }, isPending: false });
    getActiveUseQuery.mockReturnValue({ data: { accountId: 1 }, isPending: false });
    setEnvUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    logEnvSwitchCancelledUseMutation.mockReturnValue({ mutate: vi.fn() });
    invalidate.mockReset();
    invalidateEnv.mockReset();
    cancelQueries.mockReset();
  });

  it('환경이 있으면 활성 계좌 확인까지 shell 초기화 상태로 유지한다', () => {
    getActiveUseQuery.mockReturnValue({ data: undefined, isPending: true });

    const { result } = renderHook(() => useAppShell());

    expect(result.current.isInitializing).toBe(true);
    expect(getActiveUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: true, staleTime: 60_000 }),
    );
  });

  it('cancelEnvSwitch — PROD 전환 시도 취소 시 logEnvSwitchCancelled.mutate 호출', () => {
    const mutate = vi.fn();
    logEnvSwitchCancelledUseMutation.mockReturnValue({ mutate });

    const { result } = renderHook(() => useAppShell());

    // requestEnvSwitch → pendingEnv='PROD' 로 state 갱신 후 re-render.
    act(() => { result.current.requestEnvSwitch('PROD'); });
    // re-render 이후 result.current.cancelEnvSwitch 는 pendingEnv='PROD' 를 포함한 최신 closure.
    act(() => { result.current.cancelEnvSwitch(); });

    expect(mutate).toHaveBeenCalledOnce();
  });

  it('cancelEnvSwitch — MOCK 전환 취소 시 logEnvSwitchCancelled.mutate 호출 안 함', () => {
    const mutate = vi.fn();
    logEnvSwitchCancelledUseMutation.mockReturnValue({ mutate });

    const { result } = renderHook(() => useAppShell());

    act(() => { result.current.requestEnvSwitch('MOCK'); });
    act(() => { result.current.cancelEnvSwitch(); });

    expect(mutate).not.toHaveBeenCalled();
  });

  it('환경이 없으면 활성 계좌 쿼리를 초기화 gate로 쓰지 않는다', () => {
    getEnvUseQuery.mockReturnValue({ data: { env: null }, isPending: false });
    getActiveUseQuery.mockReturnValue({ data: undefined, isPending: true });

    const { result } = renderHook(() => useAppShell());

    expect(result.current.env).toBeNull();
    expect(result.current.isInitializing).toBe(false);
    expect(getActiveUseQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
  });
});
