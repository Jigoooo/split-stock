import { SegmentedToggle } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { type ReactElement, useMemo, useState } from 'react';
import { isOpenOrder } from '../model/crypto-formatters';
import { CryptoOrdersPanel } from './crypto-orders-panel';
import { CryptoTradeFeedPanel } from './crypto-trade-feed-panel';

/**
 * 코인 즉시주문 우측 FeedTabs — 국내주식 trading-panel.tsx FeedTabs 의 코인 어댑터.
 *
 * 미체결 주문 (default): 현재 마켓의 wait/watch 주문만 필터링해 CryptoOrdersPanel
 *                       (취소 가능) 로 표시.
 * 실시간 체결: WS trade stream (이미 main page 가 useState 로 보유한 liveTrades)
 *           을 CryptoTradeFeedPanel 로 표시.
 */

type CryptoFeedTab = 'active' | 'feed';

interface CryptoFeedTabsOrder {
  executedVolume: string;
  id: number;
  market: string;
  paidFee: string;
  price: string | null;
  remainingVolume: string;
  side: string;
  state: string;
  uuid: string | null;
  volume: string | null;
}

interface CryptoFeedTabsTrade {
  askBid: string;
  id: string;
  price: string;
  timestamp: number;
  volume: string;
}

export interface CryptoFeedTabsProps {
  market: string;
  enabled: boolean;
  /** 현재 마켓의 미체결 주문 (이미 wait/watch 로 필터된 배열). */
  openOrders: CryptoFeedTabsOrder[];
  /** 실시간 체결 stream. */
  trades: CryptoFeedTabsTrade[];
  cancelPending: boolean;
  onCancel: (uuid: string) => void;
  /** 미체결 주문 상세 모달 열기 (panel 마다 별도 panelId 로 충돌 방지). */
  onOpenDetail: (uuid: string) => void;
  onCloseDetail: () => void;
  detail: import('@shared/contracts').CryptoOrderDetail | null;
  detailLoading: boolean;
}

export const CryptoFeedTabs = (props: CryptoFeedTabsProps): ReactElement => {
  const {
    cancelPending,
    detail,
    detailLoading,
    enabled,
    market,
    onCancel,
    onCloseDetail,
    onOpenDetail,
    openOrders,
    trades,
  } = props;
  // 국내주식 FeedTabs 와 동일하게 미체결을 default 로.
  const [tab, setTab] = useState<CryptoFeedTab>('active');

  // 현재 마켓의 미체결만. (호출 측에서도 필터되지만 시각 일관성 위해 한번 더.)
  const marketOpenOrders = useMemo(
    () => openOrders.filter((order) => order.market === market && isOpenOrder(order.state)),
    [market, openOrders],
  );

  return (
    <div className="crypto-feed-tabs">
      <SegmentedToggle
        value={tab}
        onChange={setTab}
        ariaLabel="코인 미체결/체결"
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
          className="crypto-feed-tabs__body"
        >
          {tab === 'feed' ? (
            <CryptoTradeFeedPanel market={market} trades={trades} />
          ) : (
            <CryptoOrdersPanel
              cancelPending={cancelPending}
              detail={detail}
              detailLoading={detailLoading}
              enabled={enabled}
              onCloseDetail={onCloseDetail}
              onCancel={onCancel}
              onOpenDetail={onOpenDetail}
              orders={marketOpenOrders}
              title={`${market} 미체결`}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
