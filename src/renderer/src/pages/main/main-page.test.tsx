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
}));

vi.mock('@renderer/widgets/main-positions-pane', () => ({
  MainPositionsPane: ({
    accountId,
    onSelect,
  }: {
    accountId: number;
    selectedPdno: string | null;
    onSelect: (pdno: string) => void;
  }) => (
    <div data-testid="main-positions-pane" data-account-id={accountId}>
      <button type="button" onClick={() => onSelect('005930')}>
        종목선택
      </button>
    </div>
  ),
}));

vi.mock('@renderer/widgets/main-trade-history-pane', () => ({
  MainTradeHistoryPane: ({
    accountId,
    selectedPdno,
  }: {
    accountId: number;
    selectedPdno: string | null;
  }) => (
    <div
      data-testid="main-trade-history-pane"
      data-account-id={accountId}
      data-selected-pdno={selectedPdno ?? ''}
    />
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
  });

  it('accountId 없으면 안내 메시지 표시', () => {
    mockUseActiveAccountId.mockReturnValue({ accountId: null, isPending: false });

    render(<MainPage />);

    expect(screen.getByText('활성 계좌가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('main-positions-pane')).not.toBeInTheDocument();
  });
});
