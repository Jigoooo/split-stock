// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainTradeHistoryPane } from './ui/main-trade-history-pane';

vi.mock('@renderer/widgets/all-trade-history-panel', () => ({
  AllTradeHistoryPanel: ({ accountId }: { accountId: number }) => (
    <div data-testid="all-trade-history-panel" data-account-id={accountId} />
  ),
}));

vi.mock('@renderer/widgets/trade-history-panel', () => ({
  TradeHistoryPanel: ({ accountId, pdno }: { accountId: number; pdno: string | null }) => (
    <div data-testid="trade-history-panel" data-account-id={accountId} data-pdno={pdno ?? ''} />
  ),
}));

describe('MainTradeHistoryPane', () => {
  it('선택 종목 탭 라벨을 종목명(종목코드) 매매내역 형식으로 렌더링', () => {
    render(<MainTradeHistoryPane accountId={1} selectedPdno="005930" selectedName="삼성전자" />);

    expect(screen.getByRole('tab', { name: '삼성전자(005930) 매매내역' })).toBeInTheDocument();
  });

  it('종목명이 없으면 종목코드 매매내역으로 폴백', () => {
    render(<MainTradeHistoryPane accountId={1} selectedPdno="005930" selectedName={null} />);

    expect(screen.getByRole('tab', { name: '005930 매매내역' })).toBeInTheDocument();
  });

  it('기본은 종목 탭 컨텐츠를 렌더하고 모든 매매 내역 탭 클릭 시 전용 패널로 전환', () => {
    render(<MainTradeHistoryPane accountId={1} selectedPdno="005930" selectedName="삼성전자" />);

    expect(screen.getByTestId('trade-history-panel')).toHaveAttribute('data-pdno', '005930');
    expect(screen.queryByTestId('all-trade-history-panel')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '모든 매매내역' }));

    expect(screen.getByTestId('all-trade-history-panel')).toHaveAttribute('data-account-id', '1');
    expect(screen.queryByTestId('trade-history-panel')).toBeNull();
  });

  it('선택 종목이 없으면 모든 매매 내역 탭만 노출하고 전용 패널을 바로 렌더링', () => {
    render(<MainTradeHistoryPane accountId={1} selectedPdno={null} selectedName={null} />);

    expect(screen.getByRole('tab', { name: '모든 매매내역' })).toBeInTheDocument();
    expect(screen.queryByTestId('trade-history-panel')).toBeNull();
    expect(screen.getByTestId('all-trade-history-panel')).toBeInTheDocument();
  });
});
