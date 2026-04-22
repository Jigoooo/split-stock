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

  it('routingMode="POLLING" 일 때 폴링 인디케이터 노출', () => {
    render(
      <OrderbookPanel
        orderbook={mkOrderbook()}
        currentPrice={70400}
        onClickPrice={vi.fn()}
        routingMode="POLLING"
      />,
    );
    expect(screen.getByTestId('orderbook-routing-polling')).toBeInTheDocument();
    expect(screen.queryByTestId('orderbook-routing-ws')).toBeNull();
  });

  it('routingMode="WS" 일 때 하단 실시간 인디케이터는 노출하지 않는다', () => {
    render(
      <OrderbookPanel
        orderbook={mkOrderbook()}
        currentPrice={70400}
        onClickPrice={vi.fn()}
        routingMode="WS"
      />,
    );
    expect(screen.queryByTestId('orderbook-routing-ws')).toBeNull();
  });

  it('routingMode 미지정 시 인디케이터 미표시 (BC)', () => {
    render(
      <OrderbookPanel orderbook={mkOrderbook()} currentPrice={70400} onClickPrice={vi.fn()} />,
    );
    expect(screen.queryByTestId('orderbook-routing-ws')).toBeNull();
    expect(screen.queryByTestId('orderbook-routing-polling')).toBeNull();
  });

  it('orderbook=null + routingMode="POLLING" 일 때도 인디케이터 표시', () => {
    render(
      <OrderbookPanel
        orderbook={null}
        currentPrice={0}
        onClickPrice={vi.fn()}
        routingMode="POLLING"
      />,
    );
    expect(screen.getByTestId('orderbook-routing-polling')).toBeInTheDocument();
  });

  it('큰 숫자일 때 열 최소 너비를 넉넉히 잡아 가운데 호가가 잘리지 않게 한다', () => {
    const orderbook = mkOrderbook();
    orderbook.asks[0] = { price: 123456789012, quantity: 987654321098 };

    render(<OrderbookPanel orderbook={orderbook} currentPrice={70400} onClickPrice={vi.fn()} />);

    const priceCell = screen.getByText(/^123,456,789,012$/).closest('[data-grid-role="cell"]');
    const qtyCell = screen.getByText(/^987,654,321,098$/).closest('[data-grid-role="cell"]');

    expect(priceCell).not.toBeNull();
    expect(qtyCell).not.toBeNull();
    expect((priceCell as HTMLElement).style.minWidth).toBe('calc(15ch + 1rem)');
    expect((qtyCell as HTMLElement).style.minWidth).toBe('calc(15ch + 1rem)');
  });

  it('같은 종목 안에서는 한 번 넓어진 열 폭이 이후 틱에서 줄어들지 않는다', () => {
    const orderbook = mkOrderbook();
    orderbook.asks[0] = { price: 123456789012, quantity: 987654321098 };

    const { rerender } = render(
      <OrderbookPanel orderbook={orderbook} currentPrice={70400} onClickPrice={vi.fn()} />,
    );

    rerender(
      <OrderbookPanel orderbook={mkOrderbook()} currentPrice={70400} onClickPrice={vi.fn()} />,
    );

    const priceCell = screen.getByText(/^70,500$/).closest('[data-grid-role="cell"]');
    const qtyCell = screen.getByText(/^100$/).closest('[data-grid-role="cell"]');

    expect(priceCell).not.toBeNull();
    expect(qtyCell).not.toBeNull();
    expect((priceCell as HTMLElement).style.minWidth).toBe('calc(15ch + 1rem)');
    expect((qtyCell as HTMLElement).style.minWidth).toBe('calc(15ch + 1rem)');
  });

  it('종목이 바뀌면 열 폭 budget 을 기본값으로 다시 잡는다', () => {
    const orderbook = mkOrderbook();
    orderbook.asks[0] = { price: 123456789012, quantity: 987654321098 };

    const { rerender } = render(
      <OrderbookPanel orderbook={orderbook} currentPrice={70400} onClickPrice={vi.fn()} />,
    );

    const nextOrderbook = { ...mkOrderbook(), pdno: '000660' };

    rerender(
      <OrderbookPanel orderbook={nextOrderbook} currentPrice={70400} onClickPrice={vi.fn()} />,
    );

    const priceCell = screen.getByText(/^70,500$/).closest('[data-grid-role="cell"]');
    const qtyCell = screen.getByText(/^100$/).closest('[data-grid-role="cell"]');

    expect(priceCell).not.toBeNull();
    expect(qtyCell).not.toBeNull();
    expect((priceCell as HTMLElement).style.minWidth).toBe('calc(11ch + 1rem)');
    expect((qtyCell as HTMLElement).style.minWidth).toBe('calc(12ch + 1rem)');
  });
});
