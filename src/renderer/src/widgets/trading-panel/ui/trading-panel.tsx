import { OrderTicket, type OrderTicketSelection } from '@renderer/features/order-ticket';
import { trpc } from '@renderer/shared/api/trpc';
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

const RealtimeStatusBar = ({
  pdno,
  tickTime,
  orderbookTime,
}: {
  pdno: string;
  tickTime: string | null;
  orderbookTime: string | null;
}): ReactElement => {
  const status = trpc.realtime.status.useQuery(undefined, { refetchInterval: 3000 });
  const startRealtime = trpc.realtime.start.useMutation({
    onSuccess: () => status.refetch(),
  });
  const started = status.data?.started ?? false;
  const watched = status.data?.watched ?? [];
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
        <button
          type="button"
          className="hts-btn hts-btn--primary"
          disabled={startRealtime.isPending}
          onClick={() => startRealtime.mutate()}
        >
          재연결
        </button>
      ) : null}
      {startRealtime.error ? (
        <span className="chip chip--down">{startRealtime.error.message}</span>
      ) : null}
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
    </div>
  );
};
