// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MainPage } from './ui/main-page';

// react-resizable-panels — DOM 환경에서 레이아웃 계산 불필요하므로 stub
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

const mockUseActiveAccountId = vi.fn();
const mockUseBalanceWithLots = vi.fn();
const mockUseMainRealtime = vi.fn();

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
  useBalanceWithLots: () => mockUseBalanceWithLots(),
  usePositionOverlay: () => ({
    lines: [],
  }),
  isCryptoAccount: (account: { broker?: string | null } | null | undefined) =>
    account != null && account.broker === 'UPBIT',
  isDomesticAccount: (account: { broker?: string | null } | null | undefined) =>
    account != null && (account.broker === 'KIS' || account.broker === 'KIWOOM'),
}));

vi.mock('@renderer/pages/main/model/use-main-realtime', () => ({
  useMainRealtime: () => mockUseMainRealtime(),
}));

vi.mock('./ui/crypto-main-page', () => ({
  CryptoMainPage: ({ accountId }: { accountId: number }) => (
    <div data-testid="crypto-main-page" data-account-id={accountId} />
  ),
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

const mockBalance = (positions: ReadonlyArray<{ code: string; name: string }> = []) => ({
  positions: positions.map((position) => ({
    ...position,
    qty: 10,
    avgPrice: 50_000,
    currentPrice: 52_000,
    evalAmount: 520_000,
    pnlAmount: 20_000,
    pnlRate: 4,
  })),
  deposit: 0,
  d2Deposit: 0,
  totalEval: 0,
  estimatedAsset: 0,
  totalBuyAmount: 0,
  totalPnlAmount: 0,
  totalPnlRate: 0,
  summary: {
    deposit: 0,
    d2Deposit: 0,
    totalBuyAmount: 0,
    totalEval: 0,
    totalPnlAmount: 0,
    totalPnlRate: 0,
    estimatedAsset: 0,
  },
  lotsByPdno: {},
  mismatches: [],
  pendingMismatches: [],
  syncStatus: 'IN_SYNC',
  brokerLabel: 'KIS',
  strategiesByPdno: {},
  isPending: false,
  error: null,
});

describe('MainPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseActiveAccountId.mockReset();
    mockUseBalanceWithLots.mockReset();
    mockUseMainRealtime.mockReset();
    mockUseBalanceWithLots.mockReturnValue(mockBalance());
  });

  it('좌/우 split 마운트 — accountId 있을 때 양측 pane 렌더링', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });

    render(<MainPage />);

    expect(screen.getByTestId('main-positions-pane')).toBeInTheDocument();
    expect(screen.getByTestId('main-trade-history-pane')).toBeInTheDocument();
    expect(screen.getByText('주문할 종목을 선택하세요')).toBeInTheDocument();
  });

  it('selectedPdno 변경 시 우측 pane 의 data-selected-pdno 업데이트', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });
    mockUseBalanceWithLots.mockReturnValue(mockBalance([{ code: '005930', name: '삼성전자' }]));

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

  it('검색 선택이 현재 보유 종목이 아니면 전역 선택만 유지하고 우측 개별 매매내역은 비운다', () => {
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
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute('data-selected-pdno', '');
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute('data-selected-name', '');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-pdno', '000660');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-name', 'SK하이닉스');
  });

  it('저장된 선택 종목이 현재 잔고에 없으면 좌측/하단 선택은 유지하고 우측은 모든 매매내역만 보게 한다', () => {
    window.localStorage.setItem(
      'split-stock.main.last-pdno',
      JSON.stringify({ pdno: '005930', name: '삼성전자' }),
    );
    mockUseActiveAccountId.mockReturnValue({ accountId: 1, isPending: false });
    mockUseBalanceWithLots.mockReturnValue(mockBalance());

    render(<MainPage />);

    expect(screen.getByTestId('main-positions-pane')).toHaveAttribute(
      'data-selected-pdno',
      '005930',
    );
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute('data-selected-pdno', '');
    expect(screen.getByTestId('main-trade-history-pane')).toHaveAttribute('data-selected-name', '');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-pdno', '005930');
    expect(screen.getByTestId('trading-panel')).toHaveAttribute('data-name', '삼성전자');
  });

  it('accountId 없으면 안내 메시지 표시', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: null, isPending: false });

    render(<MainPage />);

    expect(screen.getByText('활성 계좌가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('main-positions-pane')).not.toBeInTheDocument();
  });

  it('UPBIT 계좌에서는 국내주식 hook을 마운트하지 않고 코인 화면만 렌더링한다', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 2,
      account: { broker: 'UPBIT' },
      isPending: false,
    });

    render(<MainPage />);

    expect(screen.getByTestId('crypto-main-page')).toHaveAttribute('data-account-id', '2');
    expect(screen.queryByTestId('main-positions-pane')).not.toBeInTheDocument();
    expect(mockUseMainRealtime).not.toHaveBeenCalled();
    expect(mockUseBalanceWithLots).not.toHaveBeenCalled();
  });
});
