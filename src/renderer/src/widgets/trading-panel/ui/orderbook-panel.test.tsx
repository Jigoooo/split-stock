// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LiveOrderbook } from '../model/use-live-feed';
import { OrderbookPanel } from './orderbook-panel';

function mkOrderbook(): LiveOrderbook {
  const asks = Array.from({ length: 10 }, (_, i) => ({
    price: 70500 + i * 100,
    quantity: 100 + i,
  }));
  const bids = Array.from({ length: 10 }, (_, i) => ({
    price: 70400 - i * 100,
    quantity: 200 + i,
  }));
  return {
    pdno: '005930',
    time: '093000',
    asks,
    bids,
    totalAskQty: 1000,
    totalBidQty: 2000,
    expectedPrice: 70400,
    expectedQty: 100,
  };
}

describe('OrderbookPanel', () => {
  it('로딩 상태 표시 (orderbook=null)', () => {
    render(<OrderbookPanel orderbook={null} currentPrice={0} onClickPrice={vi.fn()} />);
    expect(screen.getByText(/로드 중/)).toBeInTheDocument();
  });

  it('매도 호가 행 클릭 → onClickPrice(price, BUY) 호출', () => {
    const onClick = vi.fn();
    render(
      <OrderbookPanel orderbook={mkOrderbook()} currentPrice={70400} onClickPrice={onClick} />,
    );
    // 매도 1호가 (price=70500)
    const askPriceCell = screen.getByText(/^70,500$/);
    fireEvent.click(askPriceCell);
    expect(onClick).toHaveBeenCalledWith(70500, 'BUY');
  });

  it('매수 호가 행 클릭 → onClickPrice(price, SELL) 호출', () => {
    const onClick = vi.fn();
    render(
      <OrderbookPanel orderbook={mkOrderbook()} currentPrice={70400} onClickPrice={onClick} />,
    );
    // 매수 1호가 (price=70400)
    const bidPriceCell = screen.getByText(/^70,400$/);
    fireEvent.click(bidPriceCell);
    expect(onClick).toHaveBeenCalledWith(70400, 'SELL');
  });

  it('총 매도/매수 잔량 표시', () => {
    render(
      <OrderbookPanel orderbook={mkOrderbook()} currentPrice={70400} onClickPrice={vi.fn()} />,
    );
    expect(screen.getByText(/총 매도 1,000/)).toBeInTheDocument();
    expect(screen.getByText(/총 매수 2,000/)).toBeInTheDocument();
  });
});
