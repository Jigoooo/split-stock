import { useRealtimeStatus } from '@renderer/entities/realtime';
import { OrderTicket, type OrderTicketSelection } from '@renderer/features/order-ticket';
import { Button, SegmentedToggle } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import {
  useFocusedSubscription,
  useLiveOrderbook,
  useLiveTick,
  useRoutingMode,
  useTradeFeed,
} from '../model/use-live-feed';
import { useOrderHotkeys } from '../model/use-order-hotkeys';
import { ActiveOrdersPanel } from './active-orders-panel';
import { ORDERBOOK_PANEL_MIN_WIDTH, OrderbookPanel } from './orderbook-panel';
import { TradeFeedPanel } from './trade-feed-panel';

function formatTime(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
}

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

/**
 * `!started` 가 일정 시간 지속될 때만 재연결 UI 를 노출 — env 전환 중 realtime 이
 * 재생성되며 순간적으로 false 로 깜빡이는 상황에서 버튼이 떴다 사라지는 layout shift
 * 를 방지한다.
 */
const RECONNECT_REVEAL_DELAY_MS = 3000;

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
  const [showReconnect, setShowReconnect] = useState(false);
  useEffect(() => {
    if (started) {
      setShowReconnect(false);
      return;
    }
    const id = setTimeout(() => setShowReconnect(true), RECONNECT_REVEAL_DELAY_MS);
    return () => clearTimeout(id);
  }, [started]);
  return (
    <div
      className="panel"
      style={{
        padding: '0.4rem 0.8rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        fontSize: '1.1rem',
        flexWrap: 'nowrap',
        overflow: 'hidden',
        minHeight: '2.4rem',
      }}
    >
      <span className={started ? 'chip chip--up' : 'chip chip--down'} style={{ flexShrink: 0 }}>
        {started ? '실시간 연결됨' : '실시간 미연결'}
      </span>
      <span className="muted" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {mine
          ? `체결 ${mine.tick > 0 ? 'ON' : 'off'} · 호가 ${mine.orderbook > 0 ? 'ON' : 'off'}`
          : started
            ? '구독 대기 중…'
            : '\u00A0'}
      </span>
      <span className="muted" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {tickTime ? `체결 ${formatTime(tickTime)}` : '\u00A0'}
      </span>
      <span className="muted" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {orderbookTime ? `호가 ${formatTime(orderbookTime)}` : '\u00A0'}
      </span>
      <span style={{ flex: 1 }} />
      {showReconnect ? (
        <Button
          disabled={reconnectPending}
          onClick={reconnect}
          variant="primary"
          dense
          style={{
            flexShrink: 0,
            minHeight: '1.9rem',
            padding: '0.1rem 0.55rem',
            fontSize: '1rem',
          }}
        >
          재연결
        </Button>
      ) : null}
      {reconnectError ? (
        <span className="chip chip--down" style={{ flexShrink: 0 }}>
          {reconnectError}
        </span>
      ) : null}
      <span
        className="muted"
        title="KRX 정규장 09:00–15:30 외엔 체결가가 흐르지 않을 수 있음"
        style={{
          fontSize: '1rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        ※ 정규장(09:00–15:30) 외엔 체결가 흐름 중단 가능
      </span>
    </div>
  );
};

export const TradingPanel = (props: TradingPanelProps): ReactElement => {
  const { pdno, name, isProd } = props;
  const oneClick = !isProd && (props.oneClick ?? false);
  const hotkeysEnabled = !isProd && (props.hotkeys ?? false);

  // 사용자가 보고 있는 종목 — priority=100 으로 끌어올려 WS 슬롯 우선 배정.
  useFocusedSubscription(pdno);
  const tick = useLiveTick(pdno);
  const orderbook = useLiveOrderbook(pdno);
  const feed = useTradeFeed(pdno);
  const orderbookRoutingMode = useRoutingMode(pdno);
  const [selection, setSelection] = useState<OrderTicketSelection>({ pdno, name });
  // 상단 종목 검색에서 종목이 바뀌면 티켓의 selection 도 초기화 — suggestedPrice/side 를 지워
  // 이전 종목의 호가 클릭 값이 잔상처럼 남지 않게 한다.
  const [appliedPdno, setAppliedPdno] = useState(pdno);
  if (appliedPdno !== pdno) {
    setAppliedPdno(pdno);
    setSelection({ pdno, name });
  }

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
        height: '100%',
        minHeight: 0,
      }}
    >
      <RealtimeStatusBar
        pdno={pdno}
        tickTime={tick?.time ?? null}
        orderbookTime={orderbook?.time ?? null}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${ORDERBOOK_PANEL_MIN_WIDTH} minmax(180px, 210px) minmax(0, 1fr)`,
          gap: '0.6rem',
          alignItems: 'stretch',
          flex: 1,
          minHeight: 0,
        }}
      >
        <OrderbookPanel
          orderbook={orderbook}
          currentPrice={tick?.price ?? 0}
          onClickPrice={onPriceClick}
          routingMode={orderbookRoutingMode}
        />
        <OrderTicket selection={selection} isProd={isProd} oneClick={oneClick} />
        <FeedTabs pdno={pdno} name={name} feed={feed} />
      </div>
    </div>
  );
};

type FeedTab = 'active' | 'feed';

const FeedTabs = ({
  pdno,
  name,
  feed,
}: {
  pdno: string;
  name: string;
  feed: ReturnType<typeof useTradeFeed>;
}): ReactElement => {
  // 미체결 주문이 실사용상 더 중요 — default 로 노출하고 탭 순서도 먼저 둔다.
  const [tab, setTab] = useState<FeedTab>('active');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <SegmentedToggle
        value={tab}
        onChange={setTab}
        ariaLabel="미체결/체결"
        dense
        items={[
          { value: 'active', label: '미체결 주문' },
          { value: 'feed', label: '실시간 체결' },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.1 }}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {tab === 'feed' ? (
            <TradeFeedPanel feed={feed} name={name} pdno={pdno} />
          ) : (
            <ActiveOrdersPanel pdnoFilter={pdno} nameFilter={name} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
