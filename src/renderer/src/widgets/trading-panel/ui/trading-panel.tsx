import { OrderTicket, type OrderTicketSelection } from '@renderer/features/order-ticket';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLiveOrderbook, useLiveTick, useTradeFeed } from '../model/use-live-feed';
import { useOrderHotkeys } from '../model/use-order-hotkeys';
import { ActiveOrdersPanel } from './active-orders-panel';
import { OrderbookPanel } from './orderbook-panel';
import { TradeFeedPanel } from './trade-feed-panel';

export interface TradingPanelProps {
  pdno: string;
  name: string;
  /** 현재 환경이 PROD인지 — 원터치/단축키 기본 OFF 결정. */
  isProd: boolean;
  /** 사용자가 원터치 설정을 켰는지 (PROD에서는 무시). */
  oneClick?: boolean;
  /** 단축키 활성 여부 (PROD 기본 OFF). */
  hotkeys?: boolean;
}

export const TradingPanel = (props: TradingPanelProps): ReactElement => {
  const { pdno, name, isProd } = props;
  const oneClick = !isProd && (props.oneClick ?? false);
  const hotkeysEnabled = !isProd && (props.hotkeys ?? false);

  const tick = useLiveTick(pdno);
  const orderbook = useLiveOrderbook(pdno);
  const feed = useTradeFeed(pdno);
  const [selection, setSelection] = useState<OrderTicketSelection>({ pdno, name });

  const onPriceClick = (price: number, side: 'BUY' | 'SELL'): void => {
    setSelection({ pdno, name, suggestedPrice: price, suggestedSide: side });
  };

  useOrderHotkeys(
    {
      onBuy: () => setSelection((s) => ({ ...s, pdno, name, suggestedSide: 'BUY' })),
      onSell: () => setSelection((s) => ({ ...s, pdno, name, suggestedSide: 'SELL' })),
    },
    hotkeysEnabled,
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr', gap: '1.2rem' }}>
      <OrderbookPanel
        orderbook={orderbook}
        currentPrice={tick?.price ?? 0}
        onClickPrice={onPriceClick}
      />
      <div style={{ display: 'grid', gap: '1.2rem' }}>
        <OrderTicket selection={selection} isProd={isProd} oneClick={oneClick} />
        <ActiveOrdersPanel pdnoFilter={pdno} />
      </div>
      <TradeFeedPanel feed={feed} />
    </div>
  );
};
