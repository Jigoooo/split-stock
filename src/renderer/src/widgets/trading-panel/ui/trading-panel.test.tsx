// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TradingPanel } from './trading-panel';

vi.mock('@renderer/entities/realtime', () => ({
  useRealtimeStatus: () => ({
    reconnect: vi.fn(),
    reconnectError: null,
    reconnectPending: false,
    started: true,
    watched: [],
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
  useLiveOrderbook: () => null,
  useLiveTick: () => null,
  useRoutingMode: () => 'UNKNOWN',
  useTradeFeed: () => [],
}));

vi.mock('../model/use-order-hotkeys', () => ({
  useOrderHotkeys: () => undefined,
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
