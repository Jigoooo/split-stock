// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainPage } from './ui/main-page';

// react-resizable-panels — DOM 환경에서 레이아웃 계산 불필요하므로 stub
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

const mockUseActiveAccountId = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
  useBalanceWithLots: () => ({
    positions: [],
    deposit: 0,
    totalEval: 0,
    lotsByPdno: {},
    strategiesByPdno: {},
    isPending: false,
    error: null,
  }),
  usePositionOverlay: () => ({
    lines: [],
  }),
}));

vi.mock('@renderer/pages/main/model/use-main-realtime', () => ({
  useMainRealtime: () => undefined,
}));

vi.mock('@renderer/widgets/trading-panel', () => ({
  TradingPanel: ({ pdno, name }: { pdno: string; name: string }) => (
    <div data-testid="trading-panel" data-pdno={pdno} data-name={name} />
  ),
}));

vi.mock('@renderer/widgets/position-chart', () => ({
  PositionChart: ({ pdno, name }: { pdno: string; name: string }) => (
    <div data-testid="position-chart" data-pdno={pdno} data-name={name} />
  ),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    realtime: {
      start: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getStatus: { useQuery: () => ({ data: { started: false }, isPending: false }) },
    },
    auth: {
      getEnv: { useQuery: () => ({ data: { env: 'MOCK' } }) },
    },
    useUtils: () => ({}),
  },
}));

vi.mock('./ui/main-positions-pane', () => ({
  MainPositionsPane: ({
    accountId,
    onSelect,
    selectedPdno,
  }: {
    accountId: number;
    selectedPdno: string | null;
    onSelect: (pdno: string) => void;
  }) => (
    <div
      data-testid="main-positions-pane"
      data-account-id={accountId}
      data-selected-pdno={selectedPdno ?? ''}
    >
      <button type="button" onClick={() => onSelect('005930')}>
        종목선택
      </button>
    </div>
  ),
}));

vi.mock('./ui/main-trade-history-pane', () => ({
  MainTradeHistoryPane: ({
    accountId,
    selectedName,
    selectedPdno,
  }: {
    accountId: number;
    selectedName?: string | null;
    selectedPdno: string | null;
  }) => (
    <div
      data-testid="main-trade-history-pane"
      data-account-id={accountId}
      data-selected-name={selectedName ?? ''}
      data-selected-pdno={selectedPdno ?? ''}
    />
  ),
}));

vi.mock('@renderer/entities/stock', () => ({
  useStockList: () => ({
    entries: [{ pdno: '005930', name: '삼성전자', sector: '전기전자' }],
    total: 1,
    isLoading: false,
    error: null,
  }),
  StockPickerList: () => null,
  TradeSelectionBar: ({
    onSelect,
    selected,
  }: {
    onSelect: (entry: { pdno: string; name: string; sector: string | null }) => void;
    selected: { pdno: string; name: string } | null;
  }) => (
    <div
      data-testid="trade-selection-bar"
      data-selected-pdno={selected?.pdno ?? ''}
      data-selected-name={selected?.name ?? ''}
    >
      <button
        type="button"
        onClick={() => onSelect({ pdno: '000660', name: 'SK하이닉스', sector: '반도체' })}
      >
        검색선택
      </button>
    </div>
  ),
}));

describe('MainPage', () => {
  it('좌/우 split 마운트 — accountId 있을 때 양측 pane 렌더링', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });

    render(<MainPage />);

    expect(screen.getByTestId('main-positions-pane')).toBeInTheDocument();
    expect(screen.getByTestId('main-trade-history-pane')).toBeInTheDocument();
  });

  it('selectedPdno 변경 시 우측 pane 의 data-selected-pdno 업데이트', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });

    render(<MainPage />);

    // 초기: selectedPdno = null → ''
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute('data-selected-pdno', '');

    // 종목 선택 클릭
    fireEvent.click(screen.getByRole('button', { name: '종목선택' }));

    // selectedPdno 가 '005930' 으로 업데이트
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute(
      'data-selected-pdno',
      '005930',
    );
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute(
      'data-selected-name',
      '삼성전자',
    );
    expect(screen.getByTestId('main-positions-pane')).toHaveAttribute(
      'data-selected-pdno',
      '005930',
    );
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-pdno', '005930');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-name', '삼성전자');
  });

  it('검색 선택도 같은 전역 선택 상태를 갱신해 좌측/우측/하단 패널에 반영된다', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });

    render(<MainPage />);

    fireEvent.click(screen.getByRole('button', { name: '검색선택' }));

    expect(screen.getByTestId('trade-selection-bar')).toHaveAttribute(
      'data-selected-pdno',
      '000660',
    );
    expect(screen.getByTestId('trade-selection-bar')).toHaveAttribute(
      'data-selected-name',
      'SK하이닉스',
    );
    expect(screen.getByTestId('main-positions-pane')).toHaveAttribute(
      'data-selected-pdno',
      '000660',
    );
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute(
      'data-selected-pdno',
      '000660',
    );
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute(
      'data-selected-name',
      'SK하이닉스',
    );
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-pdno', '000660');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-name', 'SK하이닉스');
  });

  it('accountId 없으면 안내 메시지 표시', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: null, isPending: false });

    render(<MainPage />);

    expect(screen.getByText('활성 계좌가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('main-positions-pane')).not.toBeInTheDocument();
  });
});
