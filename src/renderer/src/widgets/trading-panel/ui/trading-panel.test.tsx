// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TradingPanel } from './trading-panel';

const liveFeedState = vi.hoisted(() => ({
  watched: [] as Array<{ pdno: string; tick: number; orderbook: number }>,
  tick: null as null | {
    pdno: string;
    time: string;
    price: number;
    volume: number;
    accumVolume: number;
    tickDirection: 'UP' | 'DOWN' | 'FLAT' | 'UPPER_LIMIT' | 'LOWER_LIMIT';
  },
  orderbook: null as null | {
    pdno: string;
    time: string;
    asks: unknown[];
    bids: unknown[];
    totalAskQty: number;
    totalBidQty: number;
    expectedPrice: number;
    expectedQty: number;
  },
}));

vi.mock('@renderer/entities/realtime', () => ({
  useRealtimeStatus: () => ({
    reconnect: vi.fn(),
    reconnectError: null,
    reconnectPending: false,
    started: true,
    watched: liveFeedState.watched,
  }),
}));

vi.mock('@renderer/features/order-ticket', () => ({
  OrderTicket: ({
    selection,
  }: {
    selection: {
      pdno: string;
      name: string;
      suggestedPrice?: number;
      suggestedSide?: 'BUY' | 'SELL';
    };
  }): ReactElement => (
    <div data-testid="order-ticket-selection">
      {selection.name} ({selection.pdno})
      {selection.suggestedPrice !== undefined ? ` @ ${selection.suggestedPrice}` : ''}
      {selection.suggestedSide ? ` ${selection.suggestedSide}` : ''}
    </div>
  ),
}));

vi.mock('@renderer/shared/ui', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (() => void) | undefined;
  }): ReactElement => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SegmentedToggle: ({
    items,
    onChange,
  }: {
    items: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
  }): ReactElement => (
    <div>
      {items.map((item) => (
        <button type="button" key={item.value} onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }): ReactElement => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children: ReactNode }): ReactElement => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('../model/use-live-feed', () => ({
  useFocusedSubscription: () => undefined,
  useLiveOrderbook: () => liveFeedState.orderbook,
  useLiveTick: () => liveFeedState.tick,
  useRoutingMode: () => 'UNKNOWN',
  useTradeFeed: () => [],
}));

vi.mock('./active-orders-panel', () => ({
  ActiveOrdersPanel: (): ReactElement => <div>active-orders</div>,
}));

vi.mock('./trade-feed-panel', () => ({
  TradeFeedPanel: (): ReactElement => <div>trade-feed</div>,
}));

vi.mock('./orderbook-panel', () => ({
  ORDERBOOK_PANEL_MIN_WIDTH: 320,
  OrderbookPanel: ({
    onClickPrice,
  }: {
    onClickPrice: (price: number, side: 'BUY' | 'SELL') => void;
  }): ReactElement => (
    <button type="button" onClick={() => onClickPrice(70000, 'BUY')}>
      호가 선택
    </button>
  ),
}));

describe('TradingPanel', () => {
  beforeEach(() => {
    liveFeedState.watched = [];
    liveFeedState.tick = null;
    liveFeedState.orderbook = null;
  });

  it('연결 상태 chip을 짧은 실시간 라벨로 노출한다', () => {
    render(<TradingPanel pdno="005930" name="삼성전자" isProd={false} />);

    const liveChip = screen.getByText('실시간');
    expect(liveChip).toHaveClass('chip', 'chip--live');
    expect(screen.queryByText('실시간 연결됨')).toBeNull();
  });

  it('실시간 상태 바는 체결/호가 ON/OFF와 시각을 번갈아 노출하지 않는다', () => {
    liveFeedState.watched = [{ pdno: '005930', tick: 1, orderbook: 1 }];
    liveFeedState.tick = {
      pdno: '005930',
      time: '144445',
      price: 70000,
      volume: 1,
      accumVolume: 1,
      tickDirection: 'UP',
    };
    liveFeedState.orderbook = {
      pdno: '005930',
      time: '144446',
      asks: [],
      bids: [],
      totalAskQty: 0,
      totalBidQty: 0,
      expectedPrice: 0,
      expectedQty: 0,
    };

    render(<TradingPanel pdno="005930" name="삼성전자" isProd={false} />);

    expect(screen.getByText('체결/호가 수신 중')).toBeInTheDocument();
    expect(screen.queryByText(/체결 ON/)).toBeNull();
    expect(screen.queryByText(/호가 14:44:46/)).toBeNull();
  });

  it('같은 종목에서 name만 늦게 들어와도 order ticket selection 제목을 바로 동기화한다', () => {
    const { rerender } = render(<TradingPanel pdno="005930" name="005930" isProd={false} />);

    expect(screen.getByTestId('order-ticket-selection')).toHaveTextContent('005930 (005930)');

    rerender(<TradingPanel pdno="005930" name="삼성전자" isProd={false} />);

    expect(screen.getByTestId('order-ticket-selection')).toHaveTextContent('삼성전자 (005930)');
  });

  it('호가 선택으로 생긴 suggested 값은 name 동기화 시 유지된다', () => {
    const { rerender } = render(<TradingPanel pdno="005930" name="005930" isProd={false} />);

    fireEvent.click(screen.getByRole('button', { name: '호가 선택' }));
    expect(screen.getByTestId('order-ticket-selection')).toHaveTextContent(
      '005930 (005930) @ 70000 BUY',
    );

    rerender(<TradingPanel pdno="005930" name="삼성전자" isProd={false} />);

    expect(screen.getByTestId('order-ticket-selection')).toHaveTextContent(
      '삼성전자 (005930) @ 70000 BUY',
    );
  });
});
