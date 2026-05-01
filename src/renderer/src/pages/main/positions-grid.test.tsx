// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionsGrid } from './ui/positions-grid';

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 36,
      })),
    measureElement: vi.fn(),
  }),
}));

const mockUsePositionsGrid = vi.fn();
const quickModeMutate = vi.fn();
const syncCurrentStateMutateAsync = vi.fn();
const displayMutateAsync = vi.fn();

vi.mock('./model/use-positions-grid', () => ({
  usePositionsGrid: () => mockUsePositionsGrid(),
}));

vi.mock('@renderer/entities/display-settings', () => ({
  useGetDisplaySettings: () => ({
    isPending: false,
    error: null,
    settings: {
      chart: { ma: {}, volume: {}, crosshair: {} },
      grid: { rowHeightPx: 26, stageCellMode: 'PERCENT' },
    },
  }),
  useUpdateDisplaySettings: () => ({
    mutateAsync: displayMutateAsync,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    account: {
      syncCurrentState: {
        useMutation: ({ onSuccess }: { onSuccess: () => Promise<void> | void }) => ({
          mutateAsync: async (args: unknown) => {
            syncCurrentStateMutateAsync(args);
            await onSuccess();
          },
          isPending: false,
        }),
      },
    },
    safety: {
      getState: {
        useQuery: () => ({
          data: {
            master: true,
            bySymbol: {},
            errorLock: { active: false, reason: null, triggeredAt: null },
            updatedAt: 0,
          },
          isPending: false,
          error: null,
        }),
      },
      setMaster: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearErrorLock: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    strategy: {
      setAutoModeQuick: {
        useMutation: ({
          onSuccess,
        }: {
          onSuccess: (_data: unknown, variables: { mode: string; pdno: string }) => void;
        }) => ({
          mutate: (args: { mode: string; pdno: string }) => {
            quickModeMutate(args);
            onSuccess(undefined, args);
          },
          isPending: false,
        }),
      },
      getActive: {
        invalidate: vi.fn(),
      },
      getEffectiveForEdit: {
        invalidate: vi.fn(),
      },
    },
    useUtils: () => ({
      account: {
        getBalanceWithLots: { invalidate: vi.fn() },
        getPositionOverlay: { invalidate: vi.fn() },
      },
      lots: {
        cyclesByPdno: { invalidate: vi.fn() },
        tradeHistory: { invalidate: vi.fn() },
      },
      order: {
        listActive: { invalidate: vi.fn() },
        listMyFills: { invalidate: vi.fn() },
      },
      strategy: {
        getActive: { invalidate: vi.fn() },
        getEffectiveForEdit: { invalidate: vi.fn() },
        getEffectiveMetas: { invalidate: vi.fn() },
      },
      display: {
        getSettings: { invalidate: vi.fn() },
      },
    }),
  },
}));

const summary = {
  deposit: 1_000_000,
  d2Deposit: 1_200_000,
  totalBuyAmount: 500_000,
  totalEval: 520_000,
  totalPnlAmount: 20_000,
  totalPnlRate: 4,
  estimatedAsset: 1_520_000,
};

const makeRow = (code: string, name: string) => ({
  position: {
    code,
    name,
    qty: 10,
    avgPrice: 50_000,
    currentPrice: 52_000,
    evalAmount: 520_000,
    pnlAmount: 20_000,
    pnlRate: 4,
  },
  lots: [],
  rowMaxStages: 2,
  strategyMeta: { maxStages: 2, autoBuyEnabled: true, autoSellEnabled: true },
});

const makeRowWithLot = (code: string, name: string) => ({
  ...makeRow(code, name),
  lots: [
    {
      nth: 1,
      buyPrice: 50_000,
      qty: 6,
      amountKrw: 300_000,
      status: 'OPEN',
      boughtAt: new Date('2025-01-02').getTime(),
    },
  ],
});

describe('PositionsGrid', () => {
  it('요약 바와 기본 컬럼을 렌더링한다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [],
      summary,
      syncStatus: 'IN_SYNC',
      gridMaxStages: 1,
    });

    render(<PositionsGrid accountId={1} />);

    expect(screen.getByRole('region', { name: /보유 종목 그리드/ })).toBeInTheDocument();
    expect(screen.getByText('예수금')).toBeInTheDocument();
    expect(screen.getByText('총평가손익')).toBeInTheDocument();
    expect(screen.getByText('종목명')).toBeInTheDocument();
  });

  it('확장 버튼과 행 선택이 동작한다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      summary,
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    const onSelect = vi.fn();
    render(<PositionsGrid accountId={1} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: '차수 펼치기' }));
    expect(screen.getByRole('button', { name: '차수 접기' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('삼성전자'));
    expect(onSelect).toHaveBeenCalledWith('005930');
  });

  it('자동매매 상태 셀렉트 변경 시 quick mutation을 호출한다', async () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      summary,
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    quickModeMutate.mockClear();
    render(<PositionsGrid accountId={1} />);

    const autoModeSelect = screen.getByRole('combobox', { name: '삼성전자 자동매매 상태' });
    expect(autoModeSelect).toHaveClass('positions-table__auto-select');
    expect(autoModeSelect.closest('[data-grid-role="cell"]')).toHaveClass(
      'positions-table__auto-cell',
    );
    autoModeSelect.focus();
    fireEvent.keyDown(autoModeSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(autoModeSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(autoModeSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(autoModeSelect, { key: 'Enter' });

    expect(quickModeMutate).toHaveBeenCalledWith({
      accountId: 1,
      pdno: '005930',
      mode: 'BUY_ONLY',
    });
    expect(toastMocks.success).toHaveBeenCalledWith(
      '삼성전자 자동매매 상태가 매수만 ON으로 변경되었습니다',
    );
  });

  it('불일치 경고에서 동기화 버튼을 누르면 현재 계좌로 sync를 호출한다', async () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [{ pdno: '005930', kisQty: 10, lotQty: 9, reason: 'QTY_MISMATCH' }],
      rows: [makeRow('005930', '삼성전자')],
      summary,
      syncStatus: 'MISMATCH',
      gridMaxStages: 2,
    });
    syncCurrentStateMutateAsync.mockClear();

    render(<PositionsGrid accountId={7} />);
    fireEvent.click(screen.getByRole('button', { name: '동기화' }));

    expect(syncCurrentStateMutateAsync).toHaveBeenCalledWith({ accountId: 7 });
  });

  it('기본 차수 표시 모드는 수익률이다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRowWithLot('005930', '삼성전자')],
      summary,
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={1} />);

    expect(
      screen.getByTitle(/1차 · OPEN · 매수일 2025년 1월 2일 .* · 수량 6주 · 수익률 4.00%/),
    ).toHaveTextContent('4.00%');
  });

  it('기존 잔고 스냅샷이 있으면 일시적 rate limit 에러를 테이블 본문에 노출하지 않는다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: { message: '잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      summary,
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={1} />);

    expect(
      screen.queryByText('잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'),
    ).toBeNull();
    expect(screen.getByText('삼성전자')).toBeInTheDocument();
  });

  it('표시할 잔고 스냅샷이 없으면 에러를 본문에 노출한다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: { message: '잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      mismatches: [],
      rows: [],
      summary: {
        deposit: 0,
        d2Deposit: 0,
        totalBuyAmount: 0,
        totalEval: 0,
        totalPnlAmount: 0,
        totalPnlRate: 0,
        estimatedAsset: 0,
      },
      syncStatus: 'IN_SYNC',
      gridMaxStages: 1,
    });

    render(<PositionsGrid accountId={1} />);

    expect(
      screen.getByText('잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'),
    ).toBeInTheDocument();
  });
});
