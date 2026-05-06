import {
  decimalAdd,
  decimalDiv,
  decimalGt,
  decimalMul,
  decimalSub,
  getCryptoQuote,
  isDecimalOnTick,
} from '@renderer/pages/main/model/crypto-format';
import { trpc } from '@renderer/shared/api/trpc';
import { dialog, type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import { ActiveOrdersPanel } from '@renderer/widgets/trading-panel';
import {
  type CryptoBalanceSummary,
  type CryptoCandleUnit,
  DEFAULT_CRYPTO_MARKET,
} from '@shared/contracts';
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { isOpenOrder } from '../model/crypto-formatters';
import { CryptoFeedTabs } from './crypto-feed-tabs';
import { CryptoMarketBar } from './crypto-market-bar';
import { CryptoOrderTicket } from './crypto-order-ticket';
import { CryptoOrderbookPanel } from './crypto-orderbook-panel';
import { CryptoTradeHistoryPanel } from './crypto-trade-history-panel';
import { FilledPane } from './filled-pane';
import { PositionsGrid } from './positions-grid';
import { WatchBoard } from './watch-board';

export { CryptoAutoPanel } from './crypto-auto-panel';
export { CryptoOrderbookPanel } from './crypto-orderbook-panel';
export { CryptoOrdersPanel } from './crypto-orders-panel';

import { CryptoChartPanel } from './crypto-chart-panel';
import { CryptoPastTradesPane } from './crypto-past-trades-pane';
import { MainThreeSplitLayout } from './main-three-split-layout';

interface CryptoMainPageProps {
  accountId: number;
  variant?: 'main' | 'trade-popout';
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';
type CryptoLeftTab = 'holdings' | 'auto';
type CryptoHoldingsTab = 'balances' | 'filled' | 'open' | 'past';
type CryptoOrderPanelId = 'right-selected' | 'right-all' | 'feed-tabs';

const CRYPTO_LEFT_TABS = [
  { id: 'holdings', label: '포지션' },
  { id: 'auto', label: '자동감시' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoLeftTab>>;

// Phase R3-2: 차수 / 입출금 탭 폐기. stock 동등 4탭 (실시간 잔고 / 체결 / 미체결 / 과거 거래 종목).
const CRYPTO_HOLDINGS_TABS = [
  { id: 'balances', label: '실시간 잔고' },
  { id: 'filled', label: '체결' },
  { id: 'open', label: '미체결' },
  { id: 'past', label: '과거 거래 종목' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoHoldingsTab>>;

const LIVE_TRADE_LIMIT = 60;

export function buildBalanceSummaries(input: {
  balances: Array<{
    avgBuyPrice: string;
    balance: string;
    currency: string;
    locked: string;
    unitCurrency: string;
  }>;
  market: string;
  tradePrice: string | undefined;
}): CryptoBalanceSummary[] {
  const [quoteCurrency = '', baseCurrency = ''] = input.market.split('-');
  return input.balances.map((balance) => {
    const total = decimalAdd(balance.balance, balance.locked);
    const isQuote = balance.currency === quoteCurrency;
    const canValue = isQuote || balance.currency === baseCurrency;
    const valuation = isQuote ? total : canValue ? decimalMul(total, input.tradePrice ?? '0') : '0';
    const costBasis =
      isQuote || !canValue || !decimalGt(balance.avgBuyPrice, '0')
        ? '0'
        : decimalMul(total, balance.avgBuyPrice);
    const profitLoss =
      costBasis === '0' || isQuote || !canValue ? '0' : decimalSub(valuation, costBasis);
    const profitLossRate = costBasis === '0' ? '0' : decimalDiv(profitLoss, costBasis, 8);
    return {
      currency: balance.currency,
      unitCurrency: balance.unitCurrency,
      available: balance.balance,
      locked: balance.locked,
      total,
      avgBuyPrice: balance.avgBuyPrice,
      valuation,
      costBasis,
      profitLoss,
      profitLossRate,
    };
  });
}

export const CryptoMainPage = ({
  accountId,
  variant = 'main',
}: CryptoMainPageProps): ReactElement => {
  const utils = trpc.useUtils();
  const [term, setTerm] = useState<string>(DEFAULT_CRYPTO_MARKET);
  const [market, setMarket] = useState<string>(DEFAULT_CRYPTO_MARKET);
  const [unit, setUnit] = useState<CryptoCandleUnit>('D');
  const [side, setSide] = useState<Side>('bid');
  const [mode, setMode] = useState<Mode>('limit');
  const [price, setPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [timeInForce, setTimeInForce] = useState('');
  const [smpType, setSmpType] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<{
    panelId: CryptoOrderPanelId;
    uuid: string;
  } | null>(null);
  const [leftTab, setLeftTab] = useState<CryptoLeftTab>('holdings');
  const [holdingsTab, setHoldingsTab] = useState<CryptoHoldingsTab>('balances');
  const [liveTrades, setLiveTrades] = useState<
    Array<{
      id: string;
      askBid: string;
      price: string;
      timestamp: number;
      volume: string;
    }>
  >([]);

  const envQuery = trpc.auth.getEnv.useQuery();
  const privateEnabled = envQuery.data?.env === 'PROD';
  const safetyQuery = trpc.safety.getState.useQuery({ accountId }, { staleTime: 0 });
  const marketsQuery = trpc.crypto.listMarkets.useQuery(
    { term, quoteCurrency: 'KRW', limit: 80 },
    { staleTime: 60_000 },
  );
  const tickerSubscription = trpc.crypto.onTicker.useSubscription(
    { market },
    { enabled: market.length > 0 },
  );
  const orderbookSubscription = trpc.crypto.onOrderbook.useSubscription(
    { market },
    { enabled: market.length > 0 },
  );
  const tradeSubscription = trpc.crypto.onTrade.useSubscription(
    { market },
    { enabled: market.length > 0 },
  );
  const tickerQuery = trpc.crypto.getTicker.useQuery(
    { market },
    {
      enabled: market.length > 0,
      refetchInterval: tickerSubscription.status === 'error' ? 3000 : false,
      staleTime: 2500,
    },
  );
  const orderbookQuery = trpc.crypto.getOrderbook.useQuery(
    { market, count: 15 },
    {
      enabled: market.length > 0,
      refetchInterval: orderbookSubscription.status === 'error' ? 1500 : false,
      staleTime: 1200,
    },
  );
  const instrumentsQuery = trpc.crypto.getOrderbookInstruments.useQuery(
    { markets: [market] },
    { enabled: market.length > 0, staleTime: 60_000 },
  );
  const balancesQuery = trpc.crypto.getBalances.useQuery(
    { accountId },
    { enabled: privateEnabled, staleTime: 5000, refetchInterval: privateEnabled ? 10_000 : false },
  );
  const recentOrdersQuery = trpc.crypto.listRecentOrders.useQuery(
    { accountId, limit: 80 },
    { enabled: privateEnabled, staleTime: 2000, refetchInterval: privateEnabled ? 8000 : false },
  );
  const orderDetailQuery = trpc.crypto.getOrderDetail.useQuery(
    { accountId, uuid: selectedOrder?.uuid ?? '' },
    { enabled: privateEnabled && selectedOrder !== null, staleTime: 5000 },
  );
  const watchMarket = trpc.crypto.watchMarket.useMutation();
  const unwatchMarket = trpc.crypto.unwatchMarket.useMutation();
  const watchPrivate = trpc.crypto.watchPrivate.useMutation();
  const unwatchPrivate = trpc.crypto.unwatchPrivate.useMutation();

  trpc.crypto.onPrivateOrder.useSubscription(
    { accountId },
    {
      enabled: privateEnabled,
      onData: () => {
        void Promise.all([
          utils.crypto.listRecentOrders.invalidate({ accountId, limit: 80 }),
          utils.crypto.getBalances.invalidate({ accountId }),
        ]);
      },
    },
  );
  trpc.crypto.onPrivateAsset.useSubscription(
    { accountId },
    {
      enabled: privateEnabled,
      onData: () => {
        void utils.crypto.getBalances.invalidate({ accountId });
      },
    },
  );

  useEffect(() => {
    if (!market) return;
    watchMarket.mutate({ market, unit });
    return () => {
      unwatchMarket.mutate({ market, unit });
    };
  }, [market, unit, unwatchMarket.mutate, watchMarket.mutate]);

  useEffect(() => {
    if (!privateEnabled || !market) return;
    watchPrivate.mutate({ accountId, market });
    return () => {
      unwatchPrivate.mutate({ accountId });
    };
  }, [accountId, market, privateEnabled, unwatchPrivate.mutate, watchPrivate.mutate]);

  useEffect(() => {
    const trade = tradeSubscription.data;
    if (!trade) return;
    setLiveTrades((current) => {
      const id = `${trade.timestamp}:${trade.tradeVolume}:${trade.tradePrice}`;
      if (current.some((item) => item.id === id)) return current;
      return [
        {
          id,
          askBid: trade.askBid,
          price: trade.tradePrice,
          timestamp: trade.tradeTimestamp,
          volume: trade.tradeVolume,
        },
        ...current,
      ].slice(0, LIVE_TRADE_LIMIT);
    });
  }, [tradeSubscription.data]);

  const selectedMarket = useMemo(
    () => marketsQuery.data?.entries.find((entry) => entry.market === market) ?? null,
    [market, marketsQuery.data?.entries],
  );
  const ticker = tickerSubscription.data ?? tickerQuery.data ?? null;
  const orderbook = orderbookSubscription.data ?? orderbookQuery.data ?? null;
  const instrument = instrumentsQuery.data?.entries[0] ?? null;
  const quote = getCryptoQuote(market);
  const selectedMarketLabel = formatCryptoMarketLabel(selectedMarket?.koreanName ?? null, market);
  const ordTypeFor = (chosenSide: Side): OrderType =>
    mode === 'market' ? (chosenSide === 'bid' ? 'price' : 'market') : 'limit';
  const ordType = ordTypeFor(side);
  const priceTickError =
    ordType === 'limit' && price && !isDecimalOnTick(price, instrument?.tickSize)
      ? `지정가는 tick size ${instrument?.tickSize} 단위여야 합니다.`
      : null;

  const placeOrder = trpc.crypto.placeOrder.useMutation({
    onSuccess: () => {
      setPrice('');
      setVolume('');
      void Promise.all([
        utils.crypto.getBalances.invalidate({ accountId }),
        utils.crypto.listRecentOrders.invalidate({ accountId, limit: 80 }),
      ]);
    },
  });
  const cancelOrder = trpc.crypto.cancelOrder.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.getBalances.invalidate({ accountId }),
        utils.crypto.listRecentOrders.invalidate({ accountId, limit: 80 }),
      ]);
    },
  });
  const submit = async (chosenSide: Side = side): Promise<void> => {
    if (priceTickError) return;
    const snap = safetyQuery.data;
    if (snap !== undefined) {
      if (!snap.master) {
        dialog.error({
          title: '자동매매 잠금',
          message: '글로벌 자동매매가 OFF 상태입니다. 헤더에서 자동매매를 켜주세요.',
        });
        return;
      }
      if (snap.errorLock.active) {
        dialog.error({
          title: '에러 잠금',
          message:
            snap.errorLock.reason ?? '에러 잠금 상태입니다. 잠금을 해제한 후 다시 시도하세요.',
        });
        return;
      }
    }
    const chosenOrdType = ordTypeFor(chosenSide);
    const payload = {
      accountId,
      market,
      side: chosenSide,
      ordType: chosenOrdType,
      ...(chosenOrdType === 'limit' || chosenOrdType === 'price' ? { price } : {}),
      ...(chosenOrdType === 'limit' || chosenOrdType === 'market' ? { volume } : {}),
      ...(advancedOpen && timeInForce
        ? { timeInForce: timeInForce as 'ioc' | 'fok' | 'post_only' }
        : {}),
      ...(advancedOpen && smpType
        ? { smpType: smpType as 'reduce' | 'cancel_maker' | 'cancel_taker' }
        : {}),
    };
    const confirmationPrice = chosenOrdType === 'market' ? '-' : price || '-';
    const confirmationVolume = chosenOrdType === 'price' ? '-' : volume || '-';
    const confirmed = await dialog.openAsync({
      type: 'WARNING',
      title: `Upbit ${chosenSide === 'bid' ? '매수' : '매도'} 확인`,
      confirmText: '주문 전송',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <strong>{market}</strong>
          <span>
            {chosenOrdType} · {chosenSide === 'bid' ? '매수' : '매도'} · 가격 {confirmationPrice} ·
            수량 {confirmationVolume}
          </span>
        </div>
      ),
    });
    if (!confirmed) return;
    await placeOrder.mutateAsync(payload);
  };

  const safetyAllows =
    safetyQuery.data === undefined ||
    (safetyQuery.data.master && !safetyQuery.data.errorLock.active);
  const canSubmitFor = (chosenSide: Side): boolean => {
    const chosenOrdType = ordTypeFor(chosenSide);
    return (
      privateEnabled &&
      safetyAllows &&
      market.length > 0 &&
      !placeOrder.isPending &&
      !priceTickError &&
      (chosenOrdType === 'limit'
        ? Number(price) > 0 && Number(volume) > 0
        : chosenOrdType === 'price'
          ? Number(price) > 0
          : Number(volume) > 0)
    );
  };

  const recentOrders = recentOrdersQuery.data?.orders ?? [];
  const openOrders = recentOrders.filter((order) => isOpenOrder(order.state));

  const openOrderDetail = (panelId: CryptoOrderPanelId, uuid: string): void => {
    setSelectedOrder({ panelId, uuid });
  };
  const closeOrderDetail = (): void => setSelectedOrder(null);

  const marketBar = (
    <CryptoMarketBar
      market={market}
      markets={marketsQuery.data?.entries ?? []}
      onMarketChange={(nextMarket) => {
        setMarket(nextMarket);
        setLiveTrades([]);
      }}
      onTermChange={setTerm}
      quote={quote}
      selectedName={selectedMarket?.koreanName ?? market}
      term={term}
      ticker={ticker}
      tickerFallback={tickerSubscription.status === 'error'}
    />
  );

  const tradingWorkspace = (
    <CryptoTradingWorkspace
      chart={
        <CryptoChartPanel
          market={market}
          name={selectedMarket?.koreanName ?? market}
          unit={unit}
          onUnitChange={setUnit}
        />
      }
      orderbook={
        <CryptoOrderbookPanel
          currentPrice={ticker?.tradePrice}
          market={market}
          orderbook={orderbook}
          onPickPrice={(nextPrice, nextSide) => {
            setPrice(nextPrice);
            setSide(nextSide);
            setMode('limit');
          }}
        />
      }
      ticket={
        <CryptoOrderTicket
          advancedOpen={advancedOpen}
          availableBase={
            balancesQuery.data?.balances.find((b) => b.currency === (market.split('-')[1] ?? ''))
              ?.balance ?? '0'
          }
          availableQuote={
            balancesQuery.data?.balances.find((b) => b.currency === quote)?.balance ?? '0'
          }
          baseCurrency={market.split('-')[1] ?? ''}
          canBuy={canSubmitFor('bid')}
          canSell={canSubmitFor('ask')}
          error={priceTickError ?? placeOrder.error?.message ?? null}
          mode={mode}
          onAdvancedOpenChange={setAdvancedOpen}
          onModeChange={setMode}
          onPriceChange={setPrice}
          onSmpTypeChange={setSmpType}
          onSubmit={submit}
          onTimeInForceChange={setTimeInForce}
          onVolumeChange={setVolume}
          pending={placeOrder.isPending}
          price={price}
          quoteCurrency={quote}
          side={side}
          smpType={smpType}
          timeInForce={timeInForce}
          volume={volume}
        />
      }
      tradeFeed={
        <CryptoFeedTabs
          market={market}
          marketLabel={selectedMarketLabel}
          enabled={privateEnabled}
          openOrders={openOrders}
          trades={liveTrades}
          cancelPending={cancelOrder.isPending}
          onCancel={(uuid) => cancelOrder.mutate({ accountId, uuid })}
          onOpenDetail={(uuid) => openOrderDetail('feed-tabs', uuid)}
          onCloseDetail={closeOrderDetail}
          detail={
            selectedOrder?.panelId === 'feed-tabs' ? (orderDetailQuery.data?.order ?? null) : null
          }
          detailLoading={
            selectedOrder?.panelId === 'feed-tabs' ? orderDetailQuery.isFetching : false
          }
        />
      }
    />
  );

  if (variant === 'trade-popout') {
    return (
      <div
        data-testid="crypto-trade-page"
        data-variant="trade-popout"
        className="main-bottom-section crypto-main-page crypto-main-page--popout"
      >
        {marketBar}
        {tradingWorkspace}
      </div>
    );
  }

  return (
    <div data-testid="crypto-main-page" className="crypto-main-page-shell">
      <MainThreeSplitLayout
        layoutIds={{
          horizontal: 'split-stock.layout.main.split',
          vertical: 'split-stock.layout.main.vertical',
        }}
        left={
          <CryptoLeftPane
            accountId={accountId}
            holdingsTab={holdingsTab}
            leftTab={leftTab}
            market={market}
            onHoldingsTabChange={setHoldingsTab}
            onLeftTabChange={setLeftTab}
            onSelectMarket={(nextMarket) => {
              setMarket(nextMarket);
              setLiveTrades([]);
            }}
          />
        }
        right={<CryptoTradeHistoryPanel accountId={accountId} market={market} />}
        bottom={
          <div className="main-bottom-section crypto-main-page crypto-main-page__bottom">
            {marketBar}
            {tradingWorkspace}
          </div>
        }
      />
    </div>
  );
};

const CryptoTradingWorkspace = ({
  chart,
  orderbook,
  ticket,
  tradeFeed,
}: {
  chart: ReactElement;
  orderbook: ReactElement;
  ticket: ReactElement;
  tradeFeed: ReactElement;
}): ReactElement => (
  <div className="trade-workspace-grid main-bottom-section__content crypto-trade-workspace-grid">
    <div className="crypto-chart-workspace">{chart}</div>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        className="trading-panel__grid crypto-trading-panel__grid"
        style={
          {
            '--orderbook-panel-min-width': 'minmax(250px, 1fr)',
            '--trade-feed-panel-min-width': '280px',
          } as CSSProperties
        }
      >
        {orderbook}
        {ticket}
        {tradeFeed}
      </div>
    </div>
  </div>
);

/**
 * Phase R3-2: 코인 좌측 메인 패널 — stock 컴포넌트 (PositionsGrid / FilledPane / ActiveOrdersPanel
 * / WatchBoard) 를 broker='UPBIT' 로 직접 마운트.
 *
 * - L1=포지션 → L2 3탭 (실시간 잔고 / 체결 / 미체결). 차수·입출금 탭은 폐기 (R3 사용자 결정).
 * - L1=자동감시 → WatchBoard. broker='UPBIT' 시 서버 listWatchOrders 핸들러가 cryptoAutoWatches
 *   를 WatchOrder shape 으로 변환해 반환 (Phase 3 dispatch). history 도 event_logs 매핑 (Phase 4-bis).
 *
 * PositionsGrid `onSelect(pdno)` → onSelectMarket → 우측 CryptoTradeHistoryPanel 자동 필터.
 */
const CryptoLeftPane = ({
  accountId,
  holdingsTab,
  leftTab,
  market,
  onHoldingsTabChange,
  onLeftTabChange,
  onSelectMarket,
}: {
  accountId: number;
  holdingsTab: CryptoHoldingsTab;
  leftTab: CryptoLeftTab;
  market: string;
  onHoldingsTabChange: (tab: CryptoHoldingsTab) => void;
  onLeftTabChange: (tab: CryptoLeftTab) => void;
  onSelectMarket: (market: string) => void;
}): ReactElement => {
  let content: ReactElement;
  if (leftTab === 'auto') {
    content = <WatchBoard accountId={accountId} broker="UPBIT" />;
  } else if (holdingsTab === 'filled') {
    content = <FilledPane selectedPdno={market} broker="UPBIT" />;
  } else if (holdingsTab === 'open') {
    content = <ActiveOrdersPanel pdnoFilter={market} broker="UPBIT" />;
  } else if (holdingsTab === 'past') {
    content = <CryptoPastTradesPane accountId={accountId} />;
  } else {
    content = (
      <PositionsGrid
        accountId={accountId}
        broker="UPBIT"
        selectedPdno={market}
        onSelect={onSelectMarket}
      />
    );
  }

  return (
    <section className="crypto-split-pane crypto-split-pane--left" aria-label="코인 좌측 메인 패널">
      <div className="main-positions-pane__tabs">
        <HtsTabs<CryptoLeftTab>
          tabs={CRYPTO_LEFT_TABS}
          active={leftTab}
          onChange={onLeftTabChange}
          ariaLabel="코인 좌측 패널"
        />
        {leftTab === 'holdings' ? (
          <HtsTabs<CryptoHoldingsTab>
            tabs={CRYPTO_HOLDINGS_TABS}
            active={holdingsTab}
            onChange={onHoldingsTabChange}
            ariaLabel="코인 보유 하위 탭"
          />
        ) : null}
      </div>
      <div className="crypto-split-pane__content">{content}</div>
    </section>
  );
};

function formatCryptoMarketLabel(name: string | null | undefined, market: string): string {
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName === market) return market;
  return `${trimmedName} (${market})`;
}
