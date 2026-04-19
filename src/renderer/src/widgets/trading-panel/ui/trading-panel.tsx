import { OrderTicket, type OrderTicketSelection } from '@renderer/features/order-ticket';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLiveOrderbook, useLiveTick, useTradeFeed } from '../model/use-live-feed';
import { useOrderHotkeys } from '../model/use-order-hotkeys';
import { useRealtimeStatus } from '../model/use-realtime-status';
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

const RealtimeStatusBar = ({
  pdno,
  tickTime,
  orderbookTime,
}: {
  pdno: string;
  tickTime: string | null;
  orderbookTime: string | null;
}): ReactElement => {
  const { reconnect, reconnectError, reconnectPending, started, watched } = useRealtimeStatus();
  const mine = watched.find((w) => w.pdno === pdno);
  return (
    <div
      className="panel"
      style={{
        padding: '0.4rem 0.8rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        fontSize: '1.1rem',
        flexWrap: 'wrap',
      }}
    >
      <span className={started ? 'chip chip--up' : 'chip chip--down'}>
        {started ? '실시간 연결됨' : '실시간 미연결'}
      </span>
      {mine ? (
        <span className="muted">
          체결 {mine.tick > 0 ? 'ON' : 'off'} · 호가 {mine.orderbook > 0 ? 'ON' : 'off'}
        </span>
      ) : started ? (
        <span className="muted">구독 대기 중…</span>
      ) : null}
      {tickTime ? <span className="muted">체결 {tickTime}</span> : null}
      {orderbookTime ? <span className="muted">호가 {orderbookTime}</span> : null}
      <span style={{ flex: 1 }} />
      {!started ? (
        <Button disabled={reconnectPending} onClick={reconnect} variant="primary" dense>
          재연결
        </Button>
      ) : null}
      {reconnectError ? <span className="chip chip--down">{reconnectError}</span> : null}
      <span className="muted" style={{ fontSize: '1rem' }}>
        ※ KRX 정규장 09:00–15:30 외엔 체결가가 흐르지 않을 수 있음
      </span>
    </div>
  );
};

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <RealtimeStatusBar
        pdno={pdno}
        tickTime={tick?.time ?? null}
        orderbookTime={orderbook?.time ?? null}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 220px) minmax(200px, 240px) minmax(240px, 1fr)',
          gap: '0.6rem',
          alignItems: 'start',
        }}
      >
        <OrderbookPanel
          orderbook={orderbook}
          currentPrice={tick?.price ?? 0}
          onClickPrice={onPriceClick}
        />
        <OrderTicket selection={selection} isProd={isProd} oneClick={oneClick} />
        <FeedTabs pdno={pdno} name={name} feed={feed} />
      </div>
    </div>
  );
};

type FeedTab = 'feed' | 'active';

const FeedTabs = ({
  pdno,
  name,
  feed,
}: {
  pdno: string;
  name: string;
  feed: ReturnType<typeof useTradeFeed>;
}): ReactElement => {
  const [tab, setTab] = useState<FeedTab>('feed');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <SegmentedToggle
        value={tab}
        onChange={setTab}
        ariaLabel="체결/미체결"
        dense
        items={[
          { value: 'feed', label: '실시간 체결' },
          { value: 'active', label: '미체결 주문' },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16 }}
        >
          {tab === 'feed' ? (
            <TradeFeedPanel feed={feed} name={name} pdno={pdno} />
          ) : (
            <ActiveOrdersPanel pdnoFilter={pdno} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
