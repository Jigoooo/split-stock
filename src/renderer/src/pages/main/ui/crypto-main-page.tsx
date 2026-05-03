import { useCryptoBalanceWithLots } from '@renderer/entities/account-crypto';
import { CryptoMemoForm } from '@renderer/features/crypto-memo';
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
import type {
  CryptoAutoTradeHistoryItem,
  CryptoAutoWatch,
  CryptoBalanceSummary,
  CryptoCandleUnit,
  CryptoStrategyProfile,
  CryptoTransferStatus,
} from '@shared/contracts';
import { createDefaultCryptoStrategyProfile } from '@shared/contracts';
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { isOpenOrder } from '../model/crypto-formatters';
import { storeAddCryptoWatchPrefill } from '../model/crypto-watch-popout-prefill';
import { CryptoAutoStrategyTabBody } from './crypto-auto-panel';
import { CryptoBalancesPanel } from './crypto-balances-panel';
import { CryptoLotsPanel } from './crypto-lots-panel';
import { CryptoMarketBar } from './crypto-market-bar';
import { CryptoOrderTicket } from './crypto-order-ticket';
import { CryptoOrderbookPanel } from './crypto-orderbook-panel';
import { CryptoOrdersPanel } from './crypto-orders-panel';
import { CryptoTradeFeedPanel } from './crypto-trade-feed-panel';
import { CryptoTransfersPanel } from './crypto-transfers-panel';
import { CryptoAutoTradeHistoryTable, CryptoWatchBoard } from './crypto-watch-board';

export { CryptoAutoPanel } from './crypto-auto-panel';
export { CryptoBalancesPanel } from './crypto-balances-panel';
export { CryptoOrderbookPanel } from './crypto-orderbook-panel';
export { CryptoOrdersPanel } from './crypto-orders-panel';
export { CryptoTransfersPanel } from './crypto-transfers-panel';

import { CryptoChartPanel } from './crypto-chart-panel';
import { MainThreeSplitLayout } from './main-three-split-layout';

interface CryptoMainPageProps {
  accountId: number;
  variant?: 'main' | 'trade-popout';
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';
type AutoMode = 'disabled' | 'dry-run' | 'live-small';
type CryptoLeftTab = 'holdings' | 'auto';
type CryptoHoldingsTab = 'balances' | 'lots' | 'filled' | 'open' | 'transfers';
type CryptoRightTab = 'selected-history' | 'all-history';
type CryptoRightDetailTab = 'strategy' | 'all' | 'open' | 'closed' | 'memo';
type CryptoOrderPanelId = 'left-filled' | 'left-open' | 'right-selected' | 'right-all';

const CRYPTO_LEFT_TABS = [
  { id: 'holdings', label: '포지션' },
  { id: 'auto', label: '자동감시' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoLeftTab>>;

const CRYPTO_HOLDINGS_TABS = [
  { id: 'balances', label: '실시간 잔고' },
  { id: 'lots', label: '차수' },
  { id: 'filled', label: '체결' },
  { id: 'open', label: '미체결' },
  { id: 'transfers', label: '입출금' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoHoldingsTab>>;

const CRYPTO_RIGHT_DETAIL_TABS = [
  { id: 'strategy', label: '자동매매 설정' },
  { id: 'all', label: '전체보기' },
  { id: 'open', label: '진행중' },
  { id: 'closed', label: '종료' },
  { id: 'memo', label: '메모' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoRightDetailTab>>;

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
  const [term, setTerm] = useState('KRW-BTC');
  const [market, setMarket] = useState('KRW-BTC');
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
  const [selectedTransfer, setSelectedTransfer] = useState<{
    direction: CryptoTransferStatus['direction'];
    uuid: string;
  } | null>(null);
  const [leftTab, setLeftTab] = useState<CryptoLeftTab>('holdings');
  const [holdingsTab, setHoldingsTab] = useState<CryptoHoldingsTab>('balances');
  const [rightTab, setRightTab] = useState<CryptoRightTab>('selected-history');
  const [rightDetailTab, setRightDetailTab] = useState<CryptoRightDetailTab>('strategy');
  const [autoMode, setAutoMode] = useState<AutoMode>('disabled');
  const [autoStrategyProfile, setAutoStrategyProfile] = useState<CryptoStrategyProfile>(() =>
    createDefaultCryptoStrategyProfile('KRW-BTC'),
  );
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
  const transfersQuery = trpc.crypto.listTransfers.useQuery(
    { accountId, limit: 40 },
    {
      enabled: privateEnabled,
      staleTime: 15_000,
      refetchInterval: privateEnabled ? 30_000 : false,
    },
  );
  const walletStatusesQuery = trpc.crypto.listWalletStatuses.useQuery(
    { accountId },
    {
      enabled: privateEnabled,
      staleTime: 30_000,
      refetchInterval: privateEnabled ? 60_000 : false,
    },
  );
  const orderDetailQuery = trpc.crypto.getOrderDetail.useQuery(
    { accountId, uuid: selectedOrder?.uuid ?? '' },
    { enabled: privateEnabled && selectedOrder !== null, staleTime: 5000 },
  );
  const transferDetailQuery = trpc.crypto.getTransfer.useQuery(
    {
      accountId,
      direction: selectedTransfer?.direction ?? 'deposit',
      uuid: selectedTransfer?.uuid ?? '',
    },
    { enabled: privateEnabled && selectedTransfer !== null, staleTime: 5000 },
  );
  const autoStatusQuery = trpc.crypto.getAutoStatus.useQuery(
    { accountId, market },
    {
      enabled: privateEnabled && market.startsWith('KRW-'),
      staleTime: 3000,
      refetchInterval: privateEnabled && market.startsWith('KRW-') ? 5000 : false,
    },
  );
  const autoStrategyQuery = trpc.crypto.getAutoStrategy.useQuery(
    { accountId, market },
    {
      enabled: privateEnabled && market.startsWith('KRW-'),
      staleTime: 3000,
    },
  );
  const autoWatchesQuery = trpc.crypto.listAutoWatches.useQuery(
    { accountId },
    {
      enabled: privateEnabled,
      staleTime: 3000,
      refetchInterval: privateEnabled ? 5000 : false,
    },
  );
  const selectedAutoHistoryQuery = trpc.crypto.listAutoTradeHistory.useQuery(
    {
      accountId,
      market,
      status: rightDetailTab === 'strategy' || rightDetailTab === 'memo' ? 'all' : rightDetailTab,
    },
    {
      enabled: privateEnabled && market.startsWith('KRW-'),
      staleTime: 3000,
      refetchInterval: privateEnabled ? 8000 : false,
    },
  );
  const allAutoHistoryQuery = trpc.crypto.listAutoTradeHistory.useQuery(
    { accountId, status: 'all' },
    {
      enabled: privateEnabled,
      staleTime: 3000,
      refetchInterval: privateEnabled ? 8000 : false,
    },
  );
  const autoTemplatesQuery = trpc.crypto.listAutoStrategyTemplates.useQuery(
    { accountId },
    { enabled: privateEnabled, staleTime: 10_000 },
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
  const balanceSummaries = useMemo(
    () =>
      buildBalanceSummaries({
        balances: balancesQuery.data?.balances ?? [],
        market,
        tradePrice: ticker?.tradePrice,
      }),
    [balancesQuery.data?.balances, market, ticker?.tradePrice],
  );
  const quote = getCryptoQuote(market);
  const cryptoLotsData = useCryptoBalanceWithLots(accountId, market);
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
  const saveAutoStrategy = trpc.crypto.saveAutoStrategy.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
        utils.crypto.getAutoStrategy.invalidate({ accountId, market }),
      ]);
    },
  });
  const pauseAutoWatches = trpc.crypto.pauseAutoWatches.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.listAutoWatches.invalidate({ accountId }),
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
      ]);
    },
  });
  const resumeAutoWatches = trpc.crypto.resumeAutoWatches.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.listAutoWatches.invalidate({ accountId }),
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
      ]);
    },
  });
  const deleteAutoWatches = trpc.crypto.deleteAutoWatches.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.listAutoWatches.invalidate({ accountId }),
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
      ]);
    },
  });
  const saveAutoStrategyTemplate = trpc.crypto.saveAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate({ accountId });
    },
  });
  const deleteAutoStrategyTemplate = trpc.crypto.deleteAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate({ accountId });
    },
  });

  useEffect(() => {
    const config = autoStatusQuery.data?.config;
    if (!config) return;
    setAutoMode(config.mode === 'dry-run' ? 'disabled' : config.mode);
  }, [autoStatusQuery.data?.config]);

  useEffect(() => {
    const applyProfile = (next: CryptoStrategyProfile): void => {
      setAutoStrategyProfile((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    if (autoStrategyQuery.data?.profile) {
      applyProfile(autoStrategyQuery.data.profile);
      return;
    }
    applyProfile(createDefaultCryptoStrategyProfile(market as CryptoStrategyProfile['market']));
  }, [autoStrategyQuery.data?.profile, market]);

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
  const filledOrders = recentOrders.filter((order) => !isOpenOrder(order.state));
  const autoWatches = autoWatchesQuery.data?.watches ?? [];
  const selectedWatch = autoWatches.find((watch) => watch.market === market) ?? null;
  const selectedAutoHistory = selectedAutoHistoryQuery.data?.history ?? [];
  const allAutoHistory = allAutoHistoryQuery.data?.history ?? [];
  const autoTemplates = autoTemplatesQuery.data?.templates ?? [];

  const openOrderDetail = (panelId: CryptoOrderPanelId, uuid: string): void => {
    setSelectedOrder({ panelId, uuid });
  };
  const closeOrderDetail = (): void => setSelectedOrder(null);

  const renderOrdersPanel = (
    panelId: CryptoOrderPanelId,
    title: string,
    orders: typeof recentOrders,
  ): ReactElement => (
    <CryptoOrdersPanel
      cancelPending={cancelOrder.isPending}
      detail={selectedOrder?.panelId === panelId ? (orderDetailQuery.data?.order ?? null) : null}
      detailLoading={selectedOrder?.panelId === panelId ? orderDetailQuery.isFetching : false}
      enabled={privateEnabled}
      onCloseDetail={closeOrderDetail}
      onCancel={(uuid) => {
        cancelOrder.mutate({ accountId, uuid });
      }}
      onOpenDetail={(uuid) => openOrderDetail(panelId, uuid)}
      orders={orders}
      title={title}
    />
  );

  const autoActionPending =
    pauseAutoWatches.isPending || resumeAutoWatches.isPending || deleteAutoWatches.isPending;
  const autoPanel = (
    <CryptoWatchBoard
      enabled={privateEnabled}
      events={autoStatusQuery.data?.recentEvents ?? []}
      failedHistory={allAutoHistory.filter((item) => item.status === 'failed')}
      history={allAutoHistory}
      loading={autoWatchesQuery.isFetching}
      onAdd={() => {
        storeAddCryptoWatchPrefill({
          accountId,
          market: market.startsWith('KRW-')
            ? (market as CryptoStrategyProfile['market'])
            : 'KRW-BTC',
        });
        void window.appShell?.openPopout('add-crypto-watch');
      }}
      onDelete={(ids) => deleteAutoWatches.mutate({ accountId, ids })}
      onEdit={(watch) => {
        storeAddCryptoWatchPrefill({ accountId, market: watch.market, watchId: watch.id });
        void window.appShell?.openPopout('add-crypto-watch');
      }}
      onPause={(ids) => pauseAutoWatches.mutate({ accountId, ids })}
      onResume={(ids) => resumeAutoWatches.mutate({ accountId, ids })}
      pending={autoActionPending}
      watches={autoWatches}
    />
  );

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
      tradeFeed={<CryptoTradeFeedPanel market={market} trades={liveTrades} />}
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
            autoPanel={autoPanel}
            balancesPanel={
              <CryptoBalancesPanel
                balances={balanceSummaries}
                enabled={privateEnabled}
                quote={quote}
              />
            }
            filledOrdersPanel={renderOrdersPanel('left-filled', '체결', filledOrders)}
            holdingsTab={holdingsTab}
            leftTab={leftTab}
            lotsPanel={
              <CryptoLotsPanel
                enabled={privateEnabled}
                market={market}
                lots={cryptoLotsData.lots}
                currentPrice={cryptoLotsData.position?.currentPrice ?? 0}
                quote={quote}
              />
            }
            onHoldingsTabChange={setHoldingsTab}
            onLeftTabChange={setLeftTab}
            openOrdersPanel={renderOrdersPanel('left-open', '미체결', openOrders)}
            transfersPanel={
              <CryptoTransfersPanel
                enabled={privateEnabled}
                onCloseDetail={() => setSelectedTransfer(null)}
                onOpenDetail={(transfer) =>
                  setSelectedTransfer({ direction: transfer.direction, uuid: transfer.uuid })
                }
                selectedTransfer={transferDetailQuery.data?.transfer ?? null}
                transferDetailLoading={transferDetailQuery.isFetching}
                transfers={transfersQuery.data?.transfers ?? []}
                walletStatuses={walletStatusesQuery.data?.statuses ?? []}
              />
            }
          />
        }
        right={
          <CryptoRightPane
            allHistory={allAutoHistory}
            memoPanel={<CryptoMemoForm market={market} />}
            configPanel={
              <CryptoAutoStrategyTabBody
                gate={autoStatusQuery.data?.gate ?? { ok: false, blockedReasons: ['상태 로드 전'] }}
                market={market}
                mode={autoMode}
                onDeleteTemplate={(id) => deleteAutoStrategyTemplate.mutate({ accountId, id })}
                onModeChange={setAutoMode}
                onSaveTemplate={(name, profile) =>
                  saveAutoStrategyTemplate.mutate({ accountId, name, strategy: profile })
                }
                onStrategySave={(profile) => {
                  setAutoStrategyProfile(profile);
                  saveAutoStrategy.mutate({ accountId, market, profile });
                }}
                pending={
                  saveAutoStrategy.isPending ||
                  saveAutoStrategyTemplate.isPending ||
                  deleteAutoStrategyTemplate.isPending
                }
                strategy={autoStrategyProfile}
                strategyLoading={autoStrategyQuery.isFetching}
                templates={autoTemplates}
              />
            }
            onRightTabChange={setRightTab}
            onRightDetailTabChange={setRightDetailTab}
            rightTab={rightTab}
            rightDetailTab={rightDetailTab}
            selectedMarketLabel={selectedMarketLabel}
            selectedHistory={selectedAutoHistory}
            selectedWatch={selectedWatch}
          />
        }
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

const CryptoLeftPane = ({
  autoPanel,
  balancesPanel,
  filledOrdersPanel,
  holdingsTab,
  leftTab,
  lotsPanel,
  onHoldingsTabChange,
  onLeftTabChange,
  openOrdersPanel,
  transfersPanel,
}: {
  autoPanel: ReactElement;
  balancesPanel: ReactElement;
  filledOrdersPanel: ReactElement;
  holdingsTab: CryptoHoldingsTab;
  leftTab: CryptoLeftTab;
  lotsPanel: ReactElement;
  onHoldingsTabChange: (tab: CryptoHoldingsTab) => void;
  onLeftTabChange: (tab: CryptoLeftTab) => void;
  openOrdersPanel: ReactElement;
  transfersPanel: ReactElement;
}): ReactElement => {
  let content = balancesPanel;
  if (leftTab === 'auto') content = autoPanel;
  if (leftTab === 'holdings' && holdingsTab === 'lots') content = lotsPanel;
  if (leftTab === 'holdings' && holdingsTab === 'filled') content = filledOrdersPanel;
  if (leftTab === 'holdings' && holdingsTab === 'open') content = openOrdersPanel;
  if (leftTab === 'holdings' && holdingsTab === 'transfers') content = transfersPanel;

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

const CryptoRightPane = ({
  allHistory,
  configPanel,
  memoPanel,
  onRightTabChange,
  onRightDetailTabChange,
  rightTab,
  rightDetailTab,
  selectedMarketLabel,
  selectedHistory,
  selectedWatch,
}: {
  allHistory: CryptoAutoTradeHistoryItem[];
  configPanel: ReactElement;
  memoPanel: ReactElement;
  onRightTabChange: (tab: CryptoRightTab) => void;
  onRightDetailTabChange: (tab: CryptoRightDetailTab) => void;
  rightTab: CryptoRightTab;
  rightDetailTab: CryptoRightDetailTab;
  selectedMarketLabel: string;
  selectedHistory: CryptoAutoTradeHistoryItem[];
  selectedWatch: CryptoAutoWatch | null;
}): ReactElement => {
  const tabs: ReadonlyArray<HtsTabItem<CryptoRightTab>> = [
    {
      id: 'selected-history',
      label: `${selectedMarketLabel} 매매내역`,
    },
    { id: 'all-history', label: '모든 매매내역' },
  ];
  const selectedStatus =
    rightDetailTab === 'strategy'
      ? null
      : rightDetailTab === 'open'
        ? 'open'
        : rightDetailTab === 'closed'
          ? 'closed'
          : 'all';
  const selectedContent =
    rightDetailTab === 'strategy' ? (
      configPanel
    ) : rightDetailTab === 'memo' ? (
      memoPanel
    ) : (
      <CryptoAutoTradeHistoryTable
        emptyText={`${selectedMarketLabel} 자동감시 매매 이력이 없습니다.`}
        history={
          selectedStatus === 'all'
            ? selectedHistory
            : selectedHistory.filter((item) => item.status === selectedStatus)
        }
      />
    );
  const allContent = (
    <CryptoAutoTradeHistoryTable
      emptyText="전체 코인 자동감시 매매 이력이 없습니다."
      history={allHistory}
    />
  );

  return (
    <section
      className="crypto-split-pane crypto-split-pane--right"
      aria-label="코인 우측 매매내역 패널"
    >
      <div className="main-positions-pane__tabs">
        <HtsTabs<CryptoRightTab>
          tabs={tabs}
          active={rightTab}
          onChange={onRightTabChange}
          ariaLabel="우측 외부 탭"
        />
      </div>
      <div className="crypto-split-pane__content crypto-trade-history-pane">
        {rightTab === 'selected-history' ? (
          <>
            <div className="main-positions-pane__tabs">
              <HtsTabs<CryptoRightDetailTab>
                tabs={CRYPTO_RIGHT_DETAIL_TABS}
                active={rightDetailTab}
                onChange={onRightDetailTabChange}
                ariaLabel="선택 마켓 매매내역 하위 탭"
              />
              <span className={selectedWatch?.runtimeRunning ? 'chip chip--live' : 'chip'}>
                {selectedWatch?.runtimeRunning ? '루프 실행 중' : '루프 중지'}
              </span>
            </div>
            {selectedContent}
          </>
        ) : (
          allContent
        )}
      </div>
    </section>
  );
};

function formatCryptoMarketLabel(name: string | null | undefined, market: string): string {
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName === market) return market;
  return `${trimmedName} (${market})`;
}
