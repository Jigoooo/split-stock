// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionsGrid } from './ui/positions-grid';

// useVirtualizer — 가상화 없이 items 를 직접 노출하도록 stub
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 36,
      })),
    measureElement: vi.fn(),
  }),
}));

const mockUsePositionsGrid = vi.fn();

vi.mock('./model/use-positions-grid', () => ({
  usePositionsGrid: () => mockUsePositionsGrid(),
}));

const toggleSymbolMutate = vi.fn();
const getStateInvalidate = vi.fn();
const syncCurrentStateMutateAsync = vi.fn();

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
        useQuery: () => ({ data: { bySymbol: {} } }),
      },
      toggleSymbol: {
        useMutation: ({ onSuccess }: { onSuccess: () => void }) => ({
          mutate: (args: unknown) => {
            toggleSymbolMutate(args);
            onSuccess();
          },
          isPending: false,
        }),
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
      safety: {
        getState: { invalidate: getStateInvalidate },
      },
    }),
  },
}));

const makeRow = (code: string, name: string) => ({
  position: {
    code,
    name,
    qty: 10,
    avgPrice: 50000,
    currentPrice: 52000,
    evalAmount: 520000,
    pnlAmount: 20000,
    pnlRate: 0.04,
  },
  lots: [],
  rowMaxStages: 2,
});

const makeRowWithLot = (code: string, name: string) => ({
  ...makeRow(code, name),
  lots: [
    {
      nth: 1,
      buyPrice: 50000,
      qty: 6,
      amountKrw: 300000,
      status: 'OPEN',
      boughtAt: Date.now(),
    },
  ],
});

describe('PositionsGrid', () => {
  it('마운트 + 기본 컬럼 헤더 렌더링', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 1,
    });

    render(<PositionsGrid accountId={1} />);

    expect(screen.getByRole('region', { name: /보유 종목 그리드/ })).toBeInTheDocument();
    expect(screen.getByText('종목명')).toBeInTheDocument();
    expect(screen.getByText('수량')).toBeInTheDocument();
    expect(screen.getByText('매입가')).toBeInTheDocument();
    expect(screen.getByText('현재가')).toBeInTheDocument();
  });

  it('[+] 클릭 시 expand 상태 토글', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={1} />);

    const expandBtn = screen.getByRole('button', { name: '차수 펼치기' });
    expect(expandBtn).toBeInTheDocument();
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: '차수 접기' })).toBeInTheDocument();
  });

  it('종목 row 클릭 → onSelect 호출', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    const onSelect = vi.fn();
    render(<PositionsGrid accountId={1} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('삼성전자'));
    expect(onSelect).toHaveBeenCalledWith('005930');
  });

  it('가상화 측정 row에 data-index를 노출한다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    const { container } = render(<PositionsGrid accountId={1} />);
    expect(container.querySelector('[data-position-row="005930"]')).toHaveAttribute(
      'data-index',
      '0',
    );
  });

  it('선택 종목은 배경 강조가 적용되고 차트 팝아웃 버튼은 렌더하지 않는다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    const { container } = render(<PositionsGrid accountId={1} selectedPdno="005930" />);
    const selectedRow = container.querySelector(
      '[data-position-row="005930"] [data-grid-role="row"]',
    );

    expect(selectedRow).toHaveAttribute('data-selected', 'true');
    expect(selectedRow).toHaveStyle({
      background: 'var(--accent-tint-12)',
      boxShadow: 'inset 0.2rem 0 0 0 var(--accent)',
    });
    expect(screen.queryByRole('button', { name: '삼성전자 차트' })).toBeNull();
  });

  it('자동 칩 클릭 → toggleSymbol mutation 호출, onSelect 미호출', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    toggleSymbolMutate.mockClear();

    const onSelect = vi.fn();
    render(<PositionsGrid accountId={1} onSelect={onSelect} />);

    // autoOn=null(미지정) → 버튼 텍스트 "ON", 클릭 시 on=false 로 토글
    const autoBtn = screen.getByRole('button', { name: '삼성전자 자동매매 ON' });
    fireEvent.click(autoBtn);

    expect(toggleSymbolMutate).toHaveBeenCalledWith({
      accountId: 1,
      pdno: '005930',
      on: false,
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('불일치 경고가 있으면 수동 동기화 버튼을 노출하고 현재 계좌로 sync를 호출한다', async () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [{ pdno: '005930', kisQty: 10, lotQty: 9, reason: 'QTY_MISMATCH' }],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'MISMATCH',
      gridMaxStages: 2,
    });
    syncCurrentStateMutateAsync.mockClear();

    render(<PositionsGrid accountId={7} />);

    fireEvent.click(screen.getByRole('button', { name: '동기화' }));

    expect(syncCurrentStateMutateAsync).toHaveBeenCalledWith({ accountId: 7 });
  });

  it('불일치 상세 보기 클릭 시 종목별 원인을 펼쳐 보여준다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [
        { pdno: '005930', kisQty: 10, lotQty: 9, reason: 'QTY_MISMATCH' },
        { pdno: '000660', kisQty: 3, lotQty: 0, reason: 'NO_LOTS' },
      ],
      rows: [makeRow('005930', '삼성전자')],
      syncStatus: 'MISMATCH',
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={7} />);

    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }));

    expect(screen.getByText('005930').closest('div')).toHaveTextContent(
      '005930 · 수량 불일치 · KIS 10주 / lot 9주',
    );
    expect(screen.getByText('000660').closest('div')).toHaveTextContent(
      '000660 · 잔고는 있는데 차수 장부가 없음 · KIS 3주 / lot 0주',
    );
  });

  it('차수 컬럼은 매입가/수량 대신 차수별 현재 수익률만 표시한다', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      mismatches: [],
      rows: [makeRowWithLot('005930', '삼성전자')],
      syncStatus: 'IN_SYNC',
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={1} />);

    expect(screen.getByText('4.00')).toBeInTheDocument();
    expect(screen.getByTitle('1차 · OPEN · 수익률 4.00%')).toHaveTextContent('4.00');
    expect(screen.queryByText('×6')).toBeNull();
  });
});
