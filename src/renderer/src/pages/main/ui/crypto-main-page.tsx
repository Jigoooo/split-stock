import {
  decimalAdd,
  decimalDiv,
  decimalGt,
  decimalMul,
  decimalRatioPercent,
  decimalSub,
  formatCryptoAmount,
  formatCryptoDecimal,
  formatCryptoPrice,
  formatCryptoVolume,
  getCryptoQuote,
  isDecimalOnTick,
} from '@renderer/pages/main/model/crypto-format';
import { trpc } from '@renderer/shared/api/trpc';
import {
  Button,
  Checkbox,
  dialog,
  type HtsTabItem,
  HtsTabs,
  SegmentedToggle,
  Select,
  TableGrid,
  TextInput,
} from '@renderer/shared/ui';
import type {
  CryptoAutoEvent,
  CryptoAutoGateResult,
  CryptoAutoTemplate,
  CryptoAutoTradeHistoryItem,
  CryptoAutoWatch,
  CryptoAutoWatchEntryCondition,
  CryptoAutoWatchStatus,
  CryptoBalanceSummary,
  CryptoCandleUnit,
  CryptoLot,
  CryptoOrderDetail,
  CryptoStrategyAutoMode,
  CryptoStrategyProfile,
  CryptoTransferStatus,
  CryptoWalletStatus,
} from '@shared/contracts';
import {
  createCryptoStrategyRules,
  createDefaultCryptoStrategyProfile,
  deriveCryptoStrategyAutoMode,
  MAX_CRYPTO_STRATEGY_STAGES,
} from '@shared/contracts';
import { Search } from 'lucide-react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { storeAddCryptoWatchPrefill } from '../model/crypto-watch-popout-prefill';
import { CryptoChartPanel } from './crypto-chart-panel';
import { MainThreeSplitLayout } from './main-three-split-layout';
import { WatchContextMenu, type WatchContextMenuState } from './watch-context-menu';

interface CryptoMainPageProps {
  accountId: number;
  variant?: 'main' | 'trade-popout';
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';
type AutoMode = 'disabled' | 'dry-run' | 'live-small';
type CryptoLeftTab = 'holdings' | 'auto';
type CryptoHoldingsTab = 'balances' | 'filled' | 'open' | 'transfers';
type CryptoRightTab = 'selected-history' | 'all-history';
type CryptoRightDetailTab = 'strategy' | 'all' | 'open' | 'closed';
type CryptoWatchBoardTab = 'status' | 'events' | 'failed' | 'history';
type CryptoOrderPanelId = 'left-filled' | 'left-open' | 'right-selected' | 'right-all';

const CRYPTO_LEFT_TABS = [
  { id: 'holdings', label: '포지션' },
  { id: 'auto', label: '자동감시' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoLeftTab>>;

const CRYPTO_HOLDINGS_TABS = [
  { id: 'balances', label: '실시간 잔고' },
  { id: 'filled', label: '체결' },
  { id: 'open', label: '미체결' },
  { id: 'transfers', label: '입출금' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoHoldingsTab>>;

const CRYPTO_WATCH_BOARD_TABS = [
  { id: 'status', label: '현황' },
  { id: 'events', label: '실행내역' },
  { id: 'failed', label: '실패' },
  { id: 'history', label: '히스토리' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoWatchBoardTab>>;

const CRYPTO_RIGHT_DETAIL_TABS = [
  { id: 'strategy', label: '자동매매 설정' },
  { id: 'all', label: '전체보기' },
  { id: 'open', label: '진행중' },
  { id: 'closed', label: '종료' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoRightDetailTab>>;

const LIVE_TRADE_LIMIT = 60;
const CRYPTO_AUTOCOMPLETE_LIMIT = 8;

function sanitizeDecimal(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
}

function formatSignedPrice(value: string | undefined, market: string): string {
  if (!value) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${formatCryptoPrice(Math.abs(numeric), market)}`;
}

function formatPercent(value: string | undefined): string {
  if (!value) return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${(numeric * 100).toFixed(2)}%`;
}

function formatTradeTime(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function isOpenOrder(state: string): boolean {
  return state === 'wait' || state === 'watch';
}

function stateLabel(state: string): string {
  if (state === 'wait') return '대기';
  if (state === 'watch') return '예약';
  if (state === 'done') return '완료';
  if (state === 'cancel') return '취소';
  return state;
}

function applyCryptoStrategyAutoMode(
  profile: CryptoStrategyProfile,
  mode: CryptoStrategyAutoMode,
): CryptoStrategyProfile {
  return {
    ...profile,
    autoBuyEnabled: mode === 'ALL_ON' || mode === 'BUY_ONLY',
    autoSellEnabled: mode === 'ALL_ON' || mode === 'SELL_ONLY',
  };
}

function resizeCryptoStrategyProfile(
  profile: CryptoStrategyProfile,
  maxStages: number,
): CryptoStrategyProfile {
  const safeMaxStages = Math.max(
    1,
    Math.min(MAX_CRYPTO_STRATEGY_STAGES, Math.trunc(maxStages) || 1),
  );
  const fallback = createCryptoStrategyRules(safeMaxStages, {
    amountKrw: profile.buyRules[0]?.amountKrw ?? '5000',
    dropPct: profile.buyRules[1]?.triggerDropPct ?? '0.03',
    profitPct: profile.sellRules[0]?.targetProfitPct ?? '0.02',
  });
  return {
    ...profile,
    maxStages: safeMaxStages,
    buyRules: Array.from({ length: safeMaxStages }, (_, index) => {
      const nth = index + 1;
      return (
        profile.buyRules[index] ??
        fallback.buyRules[index] ?? {
          nth,
          triggerDropPct: nth === 1 ? null : '0.03',
          amountKrw: '5000',
        }
      );
    }).map((rule, index) => ({
      ...rule,
      nth: index + 1,
      triggerDropPct: index === 0 ? null : (rule.triggerDropPct ?? '0.03'),
    })),
    sellRules: Array.from({ length: safeMaxStages }, (_, index) => {
      const nth = index + 1;
      return (
        profile.sellRules[index] ??
        fallback.sellRules[index] ?? {
          nth,
          targetProfitPct: '0.02',
        }
      );
    }).map((rule, index) => ({ ...rule, nth: index + 1 })),
  };
}

function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

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

function transferDirectionLabel(direction: CryptoTransferStatus['direction']): string {
  return direction === 'deposit' ? '입금' : '출금';
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
  const [autoEmergencyDisabled, setAutoEmergencyDisabled] = useState(true);
  const [autoMaxOrderKrw, setAutoMaxOrderKrw] = useState('5000');
  const [autoMaxExposureKrw, setAutoMaxExposureKrw] = useState('50000');
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
    { accountId, market, status: rightDetailTab === 'strategy' ? 'all' : rightDetailTab },
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
  const saveAutoConfig = trpc.crypto.saveAutoConfig.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
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
  const runAutoLiveTick = trpc.crypto.runAutoLiveTick.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.getAutoStatus.invalidate({ accountId, market }),
        utils.crypto.listRecentOrders.invalidate({ accountId, limit: 80 }),
      ]);
    },
  });
  const startAuto = trpc.crypto.startAuto.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
    },
  });
  const stopAuto = trpc.crypto.stopAuto.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
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
    setAutoEmergencyDisabled(config.emergencyDisabled);
    setAutoMaxOrderKrw(config.maxOrderKrw);
    setAutoMaxExposureKrw(config.maxTotalExposureKrw);
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

  const canSubmitFor = (chosenSide: Side): boolean => {
    const chosenOrdType = ordTypeFor(chosenSide);
    return (
      privateEnabled &&
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
            configPanel={
              <CryptoAutoStrategyTabBody
                emergencyDisabled={autoEmergencyDisabled}
                gate={autoStatusQuery.data?.gate ?? { ok: false, blockedReasons: ['상태 로드 전'] }}
                lastDryRunAt={autoStatusQuery.data?.config.lastDryRunAt ?? null}
                lastLiveActionAt={autoStatusQuery.data?.config.lastLiveActionAt ?? null}
                lastReadonlySmokeAt={autoStatusQuery.data?.config.lastReadonlySmokeAt ?? null}
                liveLots={autoStatusQuery.data?.liveLots ?? []}
                market={market}
                maxExposureKrw={autoMaxExposureKrw}
                maxOrderKrw={autoMaxOrderKrw}
                mode={autoMode}
                onDeleteTemplate={(id) => deleteAutoStrategyTemplate.mutate({ accountId, id })}
                onEmergencyDisabledChange={setAutoEmergencyDisabled}
                onMaxExposureKrwChange={(value) => setAutoMaxExposureKrw(sanitizeDecimal(value))}
                onMaxOrderKrwChange={(value) => setAutoMaxOrderKrw(sanitizeDecimal(value))}
                onModeChange={setAutoMode}
                onRunLive={() => {
                  void dialog
                    .openAsync({
                      type: 'WARNING',
                      title: '코인 자동감시 live-small 실행',
                      confirmText: '소액 live 실행',
                      cancelText: '취소',
                      isCancelWith: true,
                      message: `${market} 자동감시 live-small 1 tick을 실행합니다.`,
                    })
                    .then((confirmed) => {
                      if (confirmed) runAutoLiveTick.mutate({ accountId, market });
                    });
                }}
                onSave={() => {
                  saveAutoConfig.mutate({
                    accountId,
                    market,
                    config: {
                      mode: autoMode,
                      emergencyDisabled: autoEmergencyDisabled,
                      maxOrderKrw: autoMaxOrderKrw,
                      maxTotalExposureKrw: autoMaxExposureKrw,
                    },
                  });
                }}
                onSaveTemplate={(name, profile) =>
                  saveAutoStrategyTemplate.mutate({ accountId, name, strategy: profile })
                }
                onStrategySave={(profile) => {
                  setAutoStrategyProfile(profile);
                  saveAutoStrategy.mutate({ accountId, market, profile });
                }}
                onStart={() => {
                  startAuto.mutate({ accountId, market });
                }}
                onStop={() => {
                  stopAuto.mutate({ accountId, market });
                }}
                pending={
                  saveAutoConfig.isPending ||
                  saveAutoStrategy.isPending ||
                  runAutoLiveTick.isPending ||
                  startAuto.isPending ||
                  stopAuto.isPending ||
                  saveAutoStrategyTemplate.isPending ||
                  deleteAutoStrategyTemplate.isPending
                }
                quote={quote}
                running={autoStatusQuery.data?.runtimeRunning ?? false}
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

const CryptoMarketBar = ({
  market,
  markets,
  onMarketChange,
  onTermChange,
  quote,
  selectedName,
  term,
  ticker,
  tickerFallback,
}: {
  market: string;
  markets: Array<{ koreanName: string; market: string }>;
  onMarketChange: (market: string) => void;
  onTermChange: (term: string) => void;
  quote: string;
  selectedName: string;
  term: string;
  ticker: {
    accTradePrice24h?: string;
    highPrice?: string;
    lowPrice?: string;
    openingPrice?: string;
    signedChangePrice?: string;
    signedChangeRate?: string;
    tradePrice?: string;
  } | null;
  tickerFallback: boolean;
}): ReactElement => {
  const [focused, setFocused] = useState(false);
  const visibleMarkets = markets.slice(0, CRYPTO_AUTOCOMPLETE_LIMIT);
  const showDropdown = focused && term.trim().length > 0;
  const commit = (nextMarket: string): void => {
    onMarketChange(nextMarket);
    onTermChange(nextMarket);
    setFocused(false);
  };

  return (
    <div className="panel crypto-market-bar">
      <div className="crypto-market-bar__autocomplete">
        <TextInput
          aria-label="코인 검색"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          value={term}
          onChange={(event) => onTermChange(event.target.value.toUpperCase())}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const first = visibleMarkets[0];
              if (first) commit(first.market);
            }
            if (event.key === 'Escape') setFocused(false);
          }}
          dense
          iconLeading={<Search size={14} />}
          placeholder="코인을 검색하세요"
          className="crypto-market-bar__search"
        />
        {showDropdown ? (
          <div
            className="panel crypto-market-bar__dropdown"
            role="listbox"
            aria-label="코인 검색 결과"
          >
            {visibleMarkets.length === 0 ? (
              <div className="panel__body muted">결과 없음</div>
            ) : (
              visibleMarkets.map((entry) => (
                <button
                  key={entry.market}
                  type="button"
                  role="option"
                  aria-selected={entry.market === market}
                  className={entry.market === market ? 'hts-btn hts-btn--primary' : 'hts-btn'}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(entry.market);
                  }}
                >
                  <span className="num">{entry.market}</span>
                  <span>{entry.koreanName}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <span className="chip chip--up">
        {selectedName} ({market})
      </span>
      <span style={{ flex: 1 }} />
      <div className="crypto-market-bar__quotes">
        <strong
          className={[
            'crypto-market-bar__price',
            Number(ticker?.signedChangePrice ?? 0) < 0 ? 'num-down' : 'num-up',
          ].join(' ')}
        >
          현재가 {formatCryptoPrice(ticker?.tradePrice, market)} {quote}
        </strong>
        <span className="muted crypto-market-bar__change">
          {formatSignedPrice(ticker?.signedChangePrice, market)} ·{' '}
          {formatPercent(ticker?.signedChangeRate)}
        </span>
        <span className="muted">시가 {formatCryptoPrice(ticker?.openingPrice, market)}</span>
        <span className="muted">고가 {formatCryptoPrice(ticker?.highPrice, market)}</span>
        <span className="muted">저가 {formatCryptoPrice(ticker?.lowPrice, market)}</span>
        <span className="muted">
          거래대금 {formatCryptoAmount(ticker?.accTradePrice24h, quote)}
        </span>
      </div>
      <span className={tickerFallback ? 'chip chip--down' : 'chip chip--live'}>
        {tickerFallback ? 'REST 폴백' : '실시간'}
      </span>
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
  onHoldingsTabChange: (tab: CryptoHoldingsTab) => void;
  onLeftTabChange: (tab: CryptoLeftTab) => void;
  openOrdersPanel: ReactElement;
  transfersPanel: ReactElement;
}): ReactElement => {
  let content = balancesPanel;
  if (leftTab === 'auto') content = autoPanel;
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

export const CryptoOrderbookPanel = ({
  currentPrice,
  market,
  onPickPrice,
  orderbook,
}: {
  currentPrice: string | undefined;
  market: string;
  onPickPrice: (price: string, side: Side) => void;
  orderbook: {
    levels: Array<{ askPrice: string; askSize: string; bidPrice: string; bidSize: string }>;
    totalAskSize: string;
    totalBidSize: string;
  } | null;
}): ReactElement => {
  if (!orderbook) {
    return (
      <div className="panel orderbook-panel">
        <div className="panel__body muted">호가 로드 중…</div>
      </div>
    );
  }
  const asks = [...orderbook.levels].reverse();
  const maxSize =
    [...orderbook.levels.flatMap((level) => [level.askSize, level.bidSize])].sort((left, right) =>
      decimalGt(left, right) ? -1 : 1,
    )[0] ?? '0';
  return (
    <div className="panel orderbook-panel">
      <div className="orderbook-panel__scroll">
        <TableGrid.Root
          variant="hts"
          className="orderbook-grid"
          stickyHeader
          horizontalScroll
          zebra={false}
          aria-label="코인 호가"
          style={{ '--hts-row-height': '18px', width: '100%' } as CSSProperties}
        >
          <TableGrid.Header>
            <TableGrid.Cell flex={2} numeric style={{ justifyContent: 'flex-end' }}>
              매도잔량
            </TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              호가
            </TableGrid.Cell>
            <TableGrid.Cell flex={2} numeric>
              매수잔량
            </TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {asks.map((level, index) => (
              <CryptoOrderbookRow
                // biome-ignore lint/suspicious/noArrayIndexKey: Upbit 호가 레벨은 응답 순서가 레벨 식별자다.
                key={`ask-${index}`}
                askSize={level.askSize}
                bidSize="0"
                current={currentPrice === level.askPrice}
                market={market}
                maxSize={maxSize}
                onClick={() => onPickPrice(level.askPrice, 'bid')}
                price={level.askPrice}
                side="ask"
              />
            ))}
            {orderbook.levels.map((level, index) => (
              <CryptoOrderbookRow
                // biome-ignore lint/suspicious/noArrayIndexKey: Upbit 호가 레벨은 응답 순서가 레벨 식별자다.
                key={`bid-${index}`}
                askSize="0"
                bidSize={level.bidSize}
                current={currentPrice === level.bidPrice}
                market={market}
                maxSize={maxSize}
                onClick={() => onPickPrice(level.bidPrice, 'ask')}
                price={level.bidPrice}
                side="bid"
              />
            ))}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>
      <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', overflow: 'hidden' }}>
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          현재가 {formatCryptoPrice(currentPrice, market)} · 총 매도{' '}
          {formatCryptoVolume(orderbook.totalAskSize)} · 총 매수{' '}
          {formatCryptoVolume(orderbook.totalBidSize)}
        </span>
      </div>
    </div>
  );
};

const CryptoOrderbookRow = ({
  askSize,
  bidSize,
  current,
  market,
  maxSize,
  onClick,
  price,
  side,
}: {
  askSize: string;
  bidSize: string;
  current: boolean;
  market: string;
  maxSize: string;
  onClick: () => void;
  price: string;
  side: 'ask' | 'bid';
}): ReactElement => {
  const askPct = decimalRatioPercent(askSize, maxSize);
  const bidPct = decimalRatioPercent(bidSize, maxSize);
  return (
    <TableGrid.Row
      className={[
        'orderbook-row',
        `orderbook-row--${side === 'ask' ? 'sell' : 'buy'}`,
        current ? 'orderbook-row--current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      <TableGrid.Cell
        flex={2}
        numeric
        className={side === 'ask' ? 'num-down' : 'muted'}
        style={{ position: 'relative', justifyContent: 'flex-end' }}
      >
        {side === 'ask' ? (
          <>
            <span
              className="orderbook-row__bar orderbook-row__bar--ask"
              style={{ width: `${askPct}%` }}
            />
            <span className="orderbook-row__value">{formatCryptoVolume(askSize)}</span>
          </>
        ) : (
          '-'
        )}
      </TableGrid.Cell>
      <TableGrid.Cell flex={1} numeric className={side === 'ask' ? 'num-down' : 'num-up'}>
        {formatCryptoPrice(price, market)}
      </TableGrid.Cell>
      <TableGrid.Cell
        flex={2}
        numeric
        className={side === 'bid' ? 'num-up' : 'muted'}
        style={{ position: 'relative' }}
      >
        {side === 'bid' ? (
          <>
            <span
              className="orderbook-row__bar orderbook-row__bar--bid"
              style={{ width: `${bidPct}%` }}
            />
            <span className="orderbook-row__value">{formatCryptoVolume(bidSize)}</span>
          </>
        ) : (
          '-'
        )}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
};

const CryptoOrderTicket = ({
  advancedOpen,
  canBuy,
  canSell,
  error,
  mode,
  onAdvancedOpenChange,
  onModeChange,
  onPriceChange,
  onSmpTypeChange,
  onSubmit,
  onTimeInForceChange,
  onVolumeChange,
  pending,
  price,
  side,
  smpType,
  timeInForce,
  volume,
}: {
  advancedOpen: boolean;
  canBuy: boolean;
  canSell: boolean;
  error: string | null;
  mode: Mode;
  onAdvancedOpenChange: (open: boolean) => void;
  onModeChange: (mode: Mode) => void;
  onPriceChange: (value: string) => void;
  onSmpTypeChange: (value: string) => void;
  onSubmit: (side: Side) => Promise<void>;
  onTimeInForceChange: (value: string) => void;
  onVolumeChange: (value: string) => void;
  pending: boolean;
  price: string;
  side: Side;
  smpType: string;
  timeInForce: string;
  volume: string;
}): ReactElement => (
  <section className="panel order-ticket-form" aria-label="즉시 주문 티켓">
    <div className="panel__title">즉시 주문</div>
    <div className="order-ticket-form__scroll">
      <div className="panel__body order-ticket-form__content">
        <div className="order-ticket-form__meta">
          <span className="chip order-ticket-form__source-chip">
            {side === 'bid' ? '매수 의도' : '매도 의도'}
          </span>
          <span className="muted">호가 클릭 시 가격과 의도가 반영됩니다.</span>
        </div>
        <div className="order-ticket-form__field">
          <span className="order-ticket-form__label">구분</span>
          <SegmentedToggle
            ariaLabel="주문 유형"
            value={mode}
            onChange={onModeChange}
            dense
            items={[
              { value: 'limit', label: '지정가' },
              { value: 'market', label: '시장가' },
            ]}
          />
        </div>
        <label className="order-ticket-form__field" htmlFor="crypto-order-price">
          <span className="order-ticket-form__label">
            {mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
          </span>
          <TextInput
            id="crypto-order-price"
            aria-label={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
            value={price}
            onChange={(event) => onPriceChange(sanitizeDecimal(event.target.value))}
            placeholder={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
            dense
            disabled={mode === 'market' && side === 'ask'}
          />
        </label>
        <label className="order-ticket-form__field" htmlFor="crypto-order-volume">
          <span className="order-ticket-form__label">수량</span>
          <TextInput
            id="crypto-order-volume"
            aria-label="수량"
            value={volume}
            onChange={(event) => onVolumeChange(sanitizeDecimal(event.target.value))}
            placeholder="수량"
            dense
            disabled={mode === 'market' && side === 'bid'}
          />
        </label>
        <Checkbox
          checked={advancedOpen}
          onChange={(event) => onAdvancedOpenChange(event.currentTarget.checked)}
          label="고급 주문 옵션"
        />
        {advancedOpen ? (
          <div style={{ display: 'grid', gap: '0.45rem' }}>
            <Select
              aria-label="Time in force"
              value={timeInForce}
              onChange={(event) => onTimeInForceChange(event.target.value)}
              dense
            >
              <option value="">없음</option>
              <option value="ioc">IOC</option>
              <option value="fok">FOK</option>
              <option value="post_only">Post only</option>
            </Select>
            <Select
              aria-label="SMP"
              value={smpType}
              onChange={(event) => onSmpTypeChange(event.target.value)}
              dense
              disabled={timeInForce === 'post_only'}
            >
              <option value="">없음</option>
              <option value="reduce">Reduce</option>
              <option value="cancel_maker">Cancel maker</option>
              <option value="cancel_taker">Cancel taker</option>
            </Select>
          </div>
        ) : null}
        {error ? <span className="chip chip--down">{error}</span> : null}
        <div className="panel__body order-ticket-form__actions">
          <Button
            variant="primary"
            loading={pending}
            loadingText="전송 중…"
            disabled={!canBuy}
            onClick={() => {
              void onSubmit('bid');
            }}
            dense
          >
            매수
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            loadingText="전송 중…"
            disabled={!canSell}
            onClick={() => {
              void onSubmit('ask');
            }}
            dense
          >
            매도
          </Button>
        </div>
      </div>
    </div>
  </section>
);

const CryptoTradeFeedPanel = ({
  market,
  trades,
}: {
  market: string;
  trades: Array<{ askBid: string; id: string; price: string; timestamp: number; volume: string }>;
}): ReactElement => (
  <section className="panel crypto-trade-feed">
    <div className="panel__title">실시간 체결</div>
    <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ flex: 1, minHeight: 0 }}>
      <TableGrid.Header>
        <TableGrid.Cell width="8.8rem">시각</TableGrid.Cell>
        <TableGrid.Cell width="10rem" numeric>
          체결가
        </TableGrid.Cell>
        <TableGrid.Cell width="9rem" numeric>
          수량
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body>
        {trades.map((trade) => (
          <TableGrid.Row key={trade.id}>
            <TableGrid.Cell width="8.8rem" className="date-time-cell">
              {formatTradeTime(trade.timestamp)}
            </TableGrid.Cell>
            <TableGrid.Cell
              width="10rem"
              numeric
              className={trade.askBid === 'ASK' ? 'num-down' : 'num-up'}
            >
              {formatCryptoPrice(trade.price, market)}
            </TableGrid.Cell>
            <TableGrid.Cell width="9rem" numeric>
              {formatCryptoVolume(trade.volume)}
            </TableGrid.Cell>
          </TableGrid.Row>
        ))}
        {trades.length === 0 ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell width="100%" className="muted">
              실시간 체결 내역이 없습니다.
            </TableGrid.Cell>
          </TableGrid.Row>
        ) : null}
      </TableGrid.Body>
    </TableGrid.Root>
  </section>
);

const watchStatusLabel = (status: CryptoAutoWatchStatus): string =>
  ({
    WATCHING: '감시중',
    PAUSED: '중지',
    EXECUTED: '실행됨',
    FAILED: '실패',
    CANCELLED: '삭제됨',
  })[status];

const watchConditionLabel = (condition: CryptoAutoWatchEntryCondition): string => {
  if (condition.type === 'price-above') return `${condition.price ?? '-'} 이상`;
  if (condition.type === 'price-below') return `${condition.price ?? '-'} 이하`;
  return '즉시';
};

const CryptoWatchBoard = ({
  enabled,
  events,
  failedHistory,
  history,
  loading,
  onAdd,
  onDelete,
  onEdit,
  onPause,
  onResume,
  pending,
  watches,
}: {
  enabled: boolean;
  events: CryptoAutoEvent[];
  failedHistory: CryptoAutoTradeHistoryItem[];
  history: CryptoAutoTradeHistoryItem[];
  loading: boolean;
  onAdd: () => void;
  onDelete: (ids: number[]) => void;
  onEdit: (watch: CryptoAutoWatch) => void;
  onPause: (ids: number[]) => void;
  onResume: (ids: number[]) => void;
  pending: boolean;
  watches: CryptoAutoWatch[];
}): ReactElement => {
  const [tab, setTab] = useState<CryptoWatchBoardTab>('status');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<WatchContextMenuState | null>(null);
  const selected = Array.from(selectedIds);
  const clearMissingSelections = useMemo(
    () => new Set(watches.map((watch) => watch.id)),
    [watches],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => clearMissingSelections.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [clearMissingSelections]);
  useEffect(() => {
    if (!enabled) setMenu(null);
  }, [enabled]);

  const toggleAll = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(watches.map((watch) => watch.id)) : new Set());
  };
  const toggleOne = (id: number, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleByRow = (id: number): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const contextIdsFor = (id: number): number[] =>
    selectedIds.has(id) && selectedIds.size > 0 ? Array.from(selectedIds) : [id];
  const openContextMenu = (event: MouseEvent<HTMLDivElement>, watch: CryptoAutoWatch): void => {
    if (!enabled) return;
    event.preventDefault();
    const ids = contextIdsFor(watch.id);
    setMenu({
      ids,
      targetLabel: formatCryptoWatchMenuTarget(watches.filter((entry) => ids.includes(entry.id))),
      x: event.clientX,
      y: event.clientY,
    });
  };
  const clearAndRun = (run: (ids: number[]) => void, ids: number[]): void => {
    setMenu(null);
    setSelectedIds(new Set());
    run(ids);
  };
  const selectedWatches = watches.filter((watch) => selectedIds.has(watch.id));
  const menuWatches = menu ? watches.filter((watch) => menu.ids.includes(watch.id)) : [];
  const selectedAction = buildCryptoWatchActionState(selectedWatches, enabled);
  const menuAction = buildCryptoWatchActionState(menuWatches, enabled);
  const mutationDisabled = pending || !enabled;

  let content: ReactElement;
  if (tab === 'status') {
    content = (
      <div className="crypto-watch-board__table">
        <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동감시 현황">
          <TableGrid.Header>
            <TableGrid.Cell width="3.2rem">
              <Checkbox
                aria-label="코인 자동감시 전체 선택"
                checked={watches.length > 0 && selectedIds.size === watches.length}
                onChange={(event) => toggleAll(event.currentTarget.checked)}
                disabled={watches.length === 0}
              />
            </TableGrid.Cell>
            <TableGrid.Cell width="9rem">마켓</TableGrid.Cell>
            <TableGrid.Cell width="7rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자동매수</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자동매도</TableGrid.Cell>
            <TableGrid.Cell width="7rem" numeric>
              현재차수
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              진행중 주문
            </TableGrid.Cell>
            <TableGrid.Cell width="12rem">최초 조건</TableGrid.Cell>
            <TableGrid.Cell width="16rem">마지막 판단</TableGrid.Cell>
            <TableGrid.Cell width="16rem">차단 사유</TableGrid.Cell>
            <TableGrid.Cell width="10rem">최근 실행</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {watches.map((watch) => (
              <TableGrid.Row
                key={watch.id}
                selected={selectedIds.has(watch.id)}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('.hts-choice')) return;
                  toggleByRow(watch.id);
                }}
                onContextMenu={(event) => openContextMenu(event, watch)}
              >
                <TableGrid.Cell width="3.2rem">
                  <Checkbox
                    aria-label={`${watch.market} 선택`}
                    checked={selectedIds.has(watch.id)}
                    onChange={(event) => toggleOne(watch.id, event.currentTarget.checked)}
                    dense
                  />
                </TableGrid.Cell>
                <TableGrid.Cell width="9rem" className="num">
                  {watch.label ?? watch.market}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">{watchStatusLabel(watch.status)}</TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {watch.strategy.autoBuyEnabled ? 'ON' : 'OFF'}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {watch.strategy.autoSellEnabled ? 'ON' : 'OFF'}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem" numeric>
                  {watch.currentStage}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {watch.openOrderCount}
                </TableGrid.Cell>
                <TableGrid.Cell width="12rem">
                  {watchConditionLabel(watch.entryCondition)}
                </TableGrid.Cell>
                <TableGrid.Cell width="16rem">{watch.lastDecision ?? '-'}</TableGrid.Cell>
                <TableGrid.Cell width="16rem">
                  {watch.blockedReasons.length > 0 ? watch.blockedReasons.join(', ') : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width="10rem">{formatDateTime(watch.lastActionAt)}</TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {watches.length === 0 ? (
              <TableGrid.Row placeholder>
                <TableGrid.Cell width="100%" className="muted">
                  {loading ? '코인 자동감시를 불러오는 중…' : '등록된 코인 자동감시가 없습니다.'}
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>
    );
  } else if (tab === 'events') {
    content = (
      <CryptoAutoEventTable events={events} emptyText="선택 마켓 자동감시 실행내역이 없습니다." />
    );
  } else if (tab === 'failed') {
    content = (
      <CryptoAutoTradeHistoryTable emptyText="실패 이력이 없습니다." history={failedHistory} />
    );
  } else {
    content = <CryptoAutoTradeHistoryTable emptyText="히스토리가 없습니다." history={history} />;
  }

  return (
    <section className="panel crypto-watch-board" aria-label="코인 자동감시 보드">
      <div className="watch-board__tabs">
        <HtsTabs<CryptoWatchBoardTab>
          tabs={CRYPTO_WATCH_BOARD_TABS}
          active={tab}
          onChange={setTab}
          ariaLabel="코인 자동감시 탭"
        />
        <Button dense variant="primary" onClick={onAdd} disabled={!enabled}>
          + 추가
        </Button>
      </div>
      {tab === 'status' ? (
        <div className="watch-list__bulk-bar" role="toolbar" aria-label="선택한 코인 자동감시 작업">
          <span className="muted">{selected.length}건 선택</span>
          <Button
            dense
            disabled={mutationDisabled || !selectedAction.canResume}
            onClick={() => clearAndRun(onResume, selected)}
          >
            시작
          </Button>
          <Button
            dense
            disabled={mutationDisabled || !selectedAction.canPause}
            onClick={() => clearAndRun(onPause, selected)}
          >
            중지
          </Button>
          <Button
            dense
            variant="destructive"
            disabled={mutationDisabled || !selectedAction.canDelete}
            onClick={() => clearAndRun(onDelete, selected)}
          >
            삭제
          </Button>
          <span className="muted watch-table-toolbar__hint">{selectedAction.helpText}</span>
        </div>
      ) : (
        <div className="watch-list__bulk-bar" role="toolbar" aria-label="코인 자동감시 탭 요약">
          <span className="muted">
            {CRYPTO_WATCH_BOARD_TABS.find((item) => item.id === tab)?.label}
          </span>
        </div>
      )}
      {!enabled ? (
        <div className="panel__body muted">Upbit 실전 계좌에서 자동감시 현황을 볼 수 있습니다.</div>
      ) : (
        content
      )}
      {menu ? (
        <WatchContextMenu
          allowEdit={menu.ids.length === 1}
          allowMutations={enabled}
          canDelete={menuAction.canDelete}
          canPause={menuAction.canPause}
          canResume={menuAction.canResume}
          helpText={menuAction.helpText}
          menu={menu}
          mutationPending={pending}
          onClose={() => setMenu(null)}
          onDelete={(ids) => clearAndRun(onDelete, ids)}
          onEdit={() => {
            const target = watches.find((watch) => watch.id === menu.ids[0]);
            setMenu(null);
            if (target) onEdit(target);
          }}
          onPause={(ids) => clearAndRun(onPause, ids)}
          onResume={(ids) => clearAndRun(onResume, ids)}
        />
      ) : null}
    </section>
  );
};

function formatCryptoWatchMenuTarget(watches: CryptoAutoWatch[]): string {
  const first = watches[0];
  if (!first) return '코인 자동감시';
  const label = first.label ?? first.market;
  return watches.length > 1 ? `${label} 외 ${watches.length - 1}건` : label;
}

function buildCryptoWatchActionState(
  watches: CryptoAutoWatch[],
  enabled: boolean,
): {
  canDelete: boolean;
  canPause: boolean;
  canResume: boolean;
  helpText: string;
} {
  if (!enabled) {
    return {
      canDelete: false,
      canPause: false,
      canResume: false,
      helpText: 'Upbit 실전 계좌에서만 변경할 수 있습니다.',
    };
  }
  if (watches.length === 0) {
    return {
      canDelete: false,
      canPause: false,
      canResume: false,
      helpText: '자동감시를 선택하세요.',
    };
  }
  const canPause = watches.some((watch) => watch.status === 'WATCHING');
  const canResume = watches.some((watch) => watch.status !== 'WATCHING');
  return {
    canDelete: true,
    canPause,
    canResume,
    helpText:
      canPause || canResume
        ? '행 클릭으로 선택하고 우클릭으로 작업합니다.'
        : '변경할 수 없는 상태입니다.',
  };
}

const CryptoAutoTradeHistoryTable = ({
  emptyText,
  history,
}: {
  emptyText: string;
  history: CryptoAutoTradeHistoryItem[];
}): ReactElement => (
  <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동매매 이력">
    <TableGrid.Header>
      <TableGrid.Cell width="10rem">마켓</TableGrid.Cell>
      <TableGrid.Cell width="8rem">상태</TableGrid.Cell>
      <TableGrid.Cell width="10rem">액션</TableGrid.Cell>
      <TableGrid.Cell width="20rem">사유</TableGrid.Cell>
      <TableGrid.Cell width="10rem">모드</TableGrid.Cell>
      <TableGrid.Cell width="12rem">시각</TableGrid.Cell>
    </TableGrid.Header>
    <TableGrid.Body>
      {history.map((item) => (
        <TableGrid.Row key={item.id}>
          <TableGrid.Cell width="10rem" className="num">
            {item.market}
          </TableGrid.Cell>
          <TableGrid.Cell width="8rem">{item.status}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{item.action}</TableGrid.Cell>
          <TableGrid.Cell width="20rem">{item.reason}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{item.mode}</TableGrid.Cell>
          <TableGrid.Cell width="12rem">{formatDateTime(item.createdAt)}</TableGrid.Cell>
        </TableGrid.Row>
      ))}
      {history.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell width="100%" className="muted">
            {emptyText}
          </TableGrid.Cell>
        </TableGrid.Row>
      ) : null}
    </TableGrid.Body>
  </TableGrid.Root>
);

const CryptoAutoEventTable = ({
  emptyText,
  events,
}: {
  emptyText: string;
  events: CryptoAutoEvent[];
}): ReactElement => (
  <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동감시 실행내역">
    <TableGrid.Header>
      <TableGrid.Cell width="10rem">마켓</TableGrid.Cell>
      <TableGrid.Cell width="10rem">구분</TableGrid.Cell>
      <TableGrid.Cell width="10rem">액션</TableGrid.Cell>
      <TableGrid.Cell width="24rem">사유</TableGrid.Cell>
      <TableGrid.Cell width="12rem">시각</TableGrid.Cell>
    </TableGrid.Header>
    <TableGrid.Body>
      {events.map((event) => (
        <TableGrid.Row key={event.id}>
          <TableGrid.Cell width="10rem" className="num">
            {event.market}
          </TableGrid.Cell>
          <TableGrid.Cell width="10rem">{event.kind}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{event.action}</TableGrid.Cell>
          <TableGrid.Cell width="24rem">{event.reason}</TableGrid.Cell>
          <TableGrid.Cell width="12rem">{formatDateTime(event.createdAt)}</TableGrid.Cell>
        </TableGrid.Row>
      ))}
      {events.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell width="100%" className="muted">
            {emptyText}
          </TableGrid.Cell>
        </TableGrid.Row>
      ) : null}
    </TableGrid.Body>
  </TableGrid.Root>
);

const CRYPTO_STRATEGY_AUTO_MODE_OPTIONS: Array<{
  value: CryptoStrategyAutoMode;
  label: string;
}> = [
  { value: 'ALL_ON', label: '전체 ON' },
  { value: 'ALL_OFF', label: '전체 OFF' },
  { value: 'BUY_ONLY', label: '매수만 ON' },
  { value: 'SELL_ONLY', label: '매도만 ON' },
];

const CryptoStrategyForm = ({
  disabled,
  onSubmit,
  profile,
}: {
  disabled: boolean;
  onSubmit: (profile: CryptoStrategyProfile) => void;
  profile: CryptoStrategyProfile;
}): ReactElement => {
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const updateRule = (
    nth: number,
    field: 'amountKrw' | 'targetProfitPct' | 'triggerDropPct',
    value: string,
  ): void => {
    const sanitized = sanitizeDecimal(value);
    setDraft((current) => {
      if (field === 'amountKrw' || field === 'triggerDropPct') {
        return {
          ...current,
          buyRules: current.buyRules.map((rule) =>
            rule.nth === nth
              ? {
                  ...rule,
                  [field]: field === 'triggerDropPct' && nth === 1 ? null : sanitized,
                }
              : rule,
          ),
        };
      }
      return {
        ...current,
        sellRules: current.sellRules.map((rule) =>
          rule.nth === nth ? { ...rule, targetProfitPct: sanitized } : rule,
        ),
      };
    });
  };

  const activeRows = draft.buyRules.slice(0, draft.maxStages).map((buyRule, index) => ({
    buyRule,
    sellRule: draft.sellRules[index] ?? { nth: index + 1, targetProfitPct: '0.02' },
  }));

  return (
    <form
      className="strategy-form strategy-form--content crypto-strategy-form"
      aria-label="코인 자동감시 설정 폼"
      onSubmit={(event) => event.preventDefault()}
    >
      <section className="crypto-strategy-form__top">
        <label htmlFor="crypto-strategy-max-stages">
          <span className="muted">최대 관리차수 (1~50)</span>
          <TextInput
            id="crypto-strategy-max-stages"
            aria-label="최대 관리차수"
            dense
            disabled={disabled}
            value={String(draft.maxStages)}
            onChange={(event) =>
              setDraft((current) =>
                resizeCryptoStrategyProfile(current, Number(event.target.value)),
              )
            }
          />
        </label>
        <label htmlFor="crypto-strategy-auto-mode">
          <span className="muted">자동감시 상태</span>
          <Select
            id="crypto-strategy-auto-mode"
            aria-label="자동감시 상태"
            dense
            disabled={disabled}
            value={deriveCryptoStrategyAutoMode(draft)}
            onChange={(event) =>
              setDraft((current) =>
                applyCryptoStrategyAutoMode(current, event.target.value as CryptoStrategyAutoMode),
              )
            }
          >
            {CRYPTO_STRATEGY_AUTO_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor="crypto-strategy-buy-order-type">
          <span className="muted">자동매수 주문방식</span>
          <Select
            id="crypto-strategy-buy-order-type"
            aria-label="자동매수 주문방식"
            dense
            disabled={disabled || !draft.autoBuyEnabled}
            value={draft.autoBuyOrderType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                autoBuyOrderType: event.target.value as CryptoStrategyProfile['autoBuyOrderType'],
              }))
            }
          >
            <option value="MARKET">시장가</option>
            <option value="LIMIT">지정가</option>
          </Select>
        </label>
        <label htmlFor="crypto-strategy-sell-order-type">
          <span className="muted">자동매도 주문방식</span>
          <Select
            id="crypto-strategy-sell-order-type"
            aria-label="자동매도 주문방식"
            dense
            disabled={disabled || !draft.autoSellEnabled}
            value={draft.autoSellOrderType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                autoSellOrderType: event.target.value as CryptoStrategyProfile['autoSellOrderType'],
              }))
            }
          >
            <option value="MARKET">시장가</option>
            <option value="LIMIT">지정가</option>
          </Select>
        </label>
      </section>
      <section aria-label="차수별 자동감시 규칙" className="crypto-strategy-form__rules">
        <div className="muted crypto-strategy-form__rules-title">차수별 규칙</div>
        <div className="crypto-strategy-form__rules-head" role="presentation">
          <span />
          <span className="num-up">매수 규칙</span>
          <span className="num-down">매도 규칙</span>
        </div>
        <div className="crypto-strategy-form__rules-list">
          {activeRows.map(({ buyRule, sellRule }) => (
            <div key={buyRule.nth} className="crypto-strategy-form__rule-row">
              <strong>{buyRule.nth}차</strong>
              <div className="crypto-strategy-form__rule-buy">
                {buyRule.nth === 1 ? (
                  <span className="muted">수동진입</span>
                ) : (
                  <>
                    <TextInput
                      aria-label={`${buyRule.nth}차 자동매수 하락률`}
                      dense
                      disabled={disabled || !draft.autoBuyEnabled}
                      value={buyRule.triggerDropPct ?? ''}
                      onChange={(event) =>
                        updateRule(buyRule.nth, 'triggerDropPct', event.target.value)
                      }
                    />
                    <span>하락시 매수</span>
                  </>
                )}
                <TextInput
                  aria-label={`${buyRule.nth}차 매수금액`}
                  dense
                  disabled={disabled || !draft.autoBuyEnabled}
                  value={buyRule.amountKrw}
                  onChange={(event) => updateRule(buyRule.nth, 'amountKrw', event.target.value)}
                />
                <span>원</span>
              </div>
              <div className="crypto-strategy-form__rule-sell">
                <TextInput
                  aria-label={`${sellRule.nth}차 자동매도 익절률`}
                  dense
                  disabled={disabled || !draft.autoSellEnabled}
                  value={sellRule.targetProfitPct}
                  onChange={(event) =>
                    updateRule(sellRule.nth, 'targetProfitPct', event.target.value)
                  }
                />
                <span>수익시 매도</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="form-sticky-action-bar crypto-strategy-form__actions">
        <span className="muted">저장 대상 · 코인 차수 전략</span>
        <Button
          dense
          variant="primary"
          disabled={disabled}
          aria-label="코인 자동감시 추가/저장"
          onClick={() => onSubmit(draft)}
        >
          자동감시 추가/저장
        </Button>
      </div>
    </form>
  );
};

const CryptoAutoStrategyTabBody = ({
  emergencyDisabled,
  gate,
  lastDryRunAt,
  lastLiveActionAt,
  lastReadonlySmokeAt,
  liveLots,
  market,
  maxExposureKrw,
  maxOrderKrw,
  mode,
  onDeleteTemplate,
  onEmergencyDisabledChange,
  onMaxExposureKrwChange,
  onMaxOrderKrwChange,
  onModeChange,
  onRunLive,
  onSave,
  onSaveTemplate,
  onStrategySave,
  onStart,
  onStop,
  pending,
  quote,
  running,
  strategy,
  strategyLoading,
  templates,
}: {
  emergencyDisabled: boolean;
  gate: CryptoAutoGateResult;
  lastDryRunAt: number | null;
  lastLiveActionAt: number | null;
  lastReadonlySmokeAt: number | null;
  liveLots: CryptoLot[];
  market: string;
  maxExposureKrw: string;
  maxOrderKrw: string;
  mode: AutoMode;
  onDeleteTemplate: (id: number) => void;
  onEmergencyDisabledChange: (value: boolean) => void;
  onMaxExposureKrwChange: (value: string) => void;
  onMaxOrderKrwChange: (value: string) => void;
  onModeChange: (mode: AutoMode) => void;
  onRunLive: () => void;
  onSave: () => void;
  onSaveTemplate: (name: string, profile: CryptoStrategyProfile) => void;
  onStrategySave: (profile: CryptoStrategyProfile) => void;
  onStart: () => void;
  onStop: () => void;
  pending: boolean;
  quote: string;
  running: boolean;
  strategy: CryptoStrategyProfile;
  strategyLoading: boolean;
  templates: CryptoAutoTemplate[];
}): ReactElement => {
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('기본 코인 차수 전략');
  const selectedTemplate = templates.find((template) => String(template.id) === templateId) ?? null;

  return (
    <div className="crypto-auto-strategy-tab">
      <fieldset className="panel crypto-auto-template-bar">
        <legend className="sr-only">코인 자동매매 템플릿</legend>
        <Select
          aria-label="코인 자동매매 템플릿 선택"
          dense
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">템플릿 선택</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <TextInput
          aria-label="코인 자동매매 템플릿 이름"
          dense
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
        />
        <Button
          dense
          disabled={!selectedTemplate || pending}
          onClick={() => {
            if (selectedTemplate) onStrategySave(selectedTemplate.strategy);
          }}
        >
          불러오기
        </Button>
        <Button
          dense
          disabled={pending || templateName.trim().length === 0}
          onClick={() => onSaveTemplate(templateName.trim(), strategy)}
        >
          저장
        </Button>
        <Button
          dense
          variant="destructive"
          disabled={!selectedTemplate || pending}
          onClick={() => {
            if (selectedTemplate) onDeleteTemplate(selectedTemplate.id);
          }}
        >
          삭제
        </Button>
      </fieldset>
      <CryptoAutoPanel
        emergencyDisabled={emergencyDisabled}
        enabled={market.startsWith('KRW-')}
        events={[]}
        gate={gate}
        lastDryRunAt={lastDryRunAt}
        lastLiveActionAt={lastLiveActionAt}
        lastReadonlySmokeAt={lastReadonlySmokeAt}
        liveLots={liveLots}
        market={market}
        maxExposureKrw={maxExposureKrw}
        maxOrderKrw={maxOrderKrw}
        mode={mode}
        onEmergencyDisabledChange={onEmergencyDisabledChange}
        onMaxExposureKrwChange={onMaxExposureKrwChange}
        onMaxOrderKrwChange={onMaxOrderKrwChange}
        onModeChange={onModeChange}
        onRunLive={onRunLive}
        onSave={onSave}
        onStrategySave={onStrategySave}
        onStart={onStart}
        onStop={onStop}
        pending={pending}
        quote={quote}
        running={running}
        strategy={strategy}
        strategyLoading={strategyLoading}
      />
    </div>
  );
};

export const CryptoAutoPanel = ({
  emergencyDisabled,
  enabled,
  events,
  gate,
  lastDryRunAt,
  lastLiveActionAt,
  lastReadonlySmokeAt,
  liveLots,
  market,
  maxExposureKrw,
  maxOrderKrw,
  mode,
  onEmergencyDisabledChange,
  onMaxExposureKrwChange,
  onMaxOrderKrwChange,
  onModeChange,
  onRunLive,
  onSave,
  onStrategySave,
  onStart,
  onStop,
  pending,
  quote,
  running,
  strategy,
  strategyLoading,
}: {
  emergencyDisabled: boolean;
  enabled: boolean;
  events: CryptoAutoEvent[];
  gate: CryptoAutoGateResult;
  lastDryRunAt: number | null;
  lastLiveActionAt: number | null;
  lastReadonlySmokeAt: number | null;
  liveLots: CryptoLot[];
  market: string;
  maxExposureKrw: string;
  maxOrderKrw: string;
  mode: AutoMode;
  onEmergencyDisabledChange: (value: boolean) => void;
  onMaxExposureKrwChange: (value: string) => void;
  onMaxOrderKrwChange: (value: string) => void;
  onModeChange: (mode: AutoMode) => void;
  onRunLive: () => void;
  onSave: () => void;
  onStrategySave: (profile: CryptoStrategyProfile) => void;
  onStart: () => void;
  onStop: () => void;
  pending: boolean;
  quote: string;
  running: boolean;
  strategy: CryptoStrategyProfile;
  strategyLoading: boolean;
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-auto-panel">
    <div className="panel__title">자동감시</div>
    {!enabled ? (
      <div className="panel__body muted">Upbit KRW 실전 계좌와 KRW 마켓에서만 동작합니다.</div>
    ) : (
      <div className="panel__body crypto-auto-panel__body">
        <div className="crypto-auto-panel__controls">
          <SegmentedToggle
            ariaLabel="코인 자동감시 모드"
            value={mode === 'dry-run' ? 'disabled' : mode}
            onChange={onModeChange}
            dense
            items={[
              { value: 'disabled', label: '중지' },
              { value: 'live-small', label: '소액 실거래' },
            ]}
          />
          <Checkbox
            checked={emergencyDisabled}
            onChange={(event) => onEmergencyDisabledChange(event.currentTarget.checked)}
            label="비상 중지"
          />
          <span className={running ? 'chip chip--live' : 'chip'}>
            {running ? '루프 실행 중' : '루프 중지'}
          </span>
          <span className={gate.ok ? 'chip chip--live' : 'chip chip--down'}>
            {gate.ok ? '실거래 조건 통과' : '실거래 조건 차단'}
          </span>
        </div>
        {strategyLoading ? <span className="muted">차수 전략 로드 중…</span> : null}
        <CryptoStrategyForm disabled={pending} profile={strategy} onSubmit={onStrategySave} />
        <div className="crypto-auto-panel__settings">
          <label htmlFor="crypto-auto-max-order-krw">
            <span className="muted">주문당 상한</span>
            <TextInput
              id="crypto-auto-max-order-krw"
              aria-label="주문당 상한"
              dense
              value={maxOrderKrw}
              onChange={(event) => onMaxOrderKrwChange(event.target.value)}
            />
          </label>
          <label htmlFor="crypto-auto-max-exposure-krw">
            <span className="muted">총 노출 상한</span>
            <TextInput
              id="crypto-auto-max-exposure-krw"
              aria-label="총 노출 상한"
              dense
              value={maxExposureKrw}
              onChange={(event) => onMaxExposureKrwChange(event.target.value)}
            />
          </label>
        </div>
        {gate.blockedReasons.length > 0 ? (
          <div className="crypto-auto-panel__reasons">
            {gate.blockedReasons.map((reason) => (
              <span key={reason} className="chip chip--down">
                {reason}
              </span>
            ))}
          </div>
        ) : null}
        <div className="crypto-auto-panel__timestamps">
          <span>read-only smoke {formatDateTime(lastReadonlySmokeAt)}</span>
          <span>마지막 내부 검증 {formatDateTime(lastDryRunAt)}</span>
          <span>마지막 실거래 실행 {formatDateTime(lastLiveActionAt)}</span>
        </div>
        <div className="crypto-auto-panel__actions">
          <Button dense loading={pending} onClick={onSave}>
            보호 설정 저장
          </Button>
          <Button dense disabled={pending || !gate.ok} variant="destructive" onClick={onRunLive}>
            소액 실거래 1회
          </Button>
          <Button
            dense
            disabled={pending || running || (mode === 'live-small' && !gate.ok)}
            onClick={onStart}
          >
            루프 시작
          </Button>
          <Button dense disabled={pending || !running} onClick={onStop}>
            루프 중지
          </Button>
        </div>
        <div className="crypto-auto-panel__lists">
          <div>
            <strong>실거래 차수</strong>
            {liveLots.length === 0 ? <p className="muted">실거래 차수 없음</p> : null}
            {liveLots.slice(0, 4).map((lot) => (
              <p key={lot.id}>
                #{lot.sequence} {formatCryptoVolume(lot.quantity)} · 평단{' '}
                {formatCryptoPrice(lot.avgEntryKrw, market)} · 배정{' '}
                {formatCryptoAmount(lot.allocatedKrw, quote)}
              </p>
            ))}
          </div>
          <div>
            <strong>최근 판단</strong>
            {events.length === 0 ? <p className="muted">판단 이력 없음</p> : null}
            {events.slice(0, 4).map((event) => (
              <p key={event.id}>
                {formatDateTime(event.createdAt)} · {event.action} · {event.reason}
              </p>
            ))}
          </div>
        </div>
      </div>
    )}
  </section>
);

export const CryptoBalancesPanel = ({
  balances,
  enabled,
  quote,
}: {
  balances: CryptoBalanceSummary[];
  enabled: boolean;
  quote: string;
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">실시간 잔고</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
        <TableGrid.Header>
          <TableGrid.Cell width="7rem">자산</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            주문가능
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            잠김
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            평단
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            평가
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            손익
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {balances.map((balance) => (
            <TableGrid.Row key={balance.currency}>
              <TableGrid.Cell width="7rem">{balance.currency}</TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatBalanceQuantity(balance.available, balance.currency, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatBalanceQuantity(balance.locked, balance.currency, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(balance.avgBuyPrice, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(balance.valuation, quote)}
              </TableGrid.Cell>
              <TableGrid.Cell
                flex={1}
                numeric
                className={
                  hasMeaningfulBalanceProfitLoss(balance, quote)
                    ? Number(balance.profitLoss) < 0
                      ? 'num-down'
                      : 'num-up'
                    : 'muted'
                }
              >
                {formatBalanceProfitLoss(balance, quote)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
          {balances.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell width="100%" className="muted">
                조회된 실시간 잔고가 없습니다.
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);

function hasMeaningfulBalanceProfitLoss(balance: CryptoBalanceSummary, quote: string): boolean {
  if (balance.currency === quote) return false;
  const costBasis = Number(balance.costBasis);
  const valuation = Number(balance.valuation);
  return Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(valuation);
}

function formatBalanceProfitLoss(balance: CryptoBalanceSummary, quote: string): string {
  if (!hasMeaningfulBalanceProfitLoss(balance, quote)) return '-';
  return `${formatCryptoAmount(balance.profitLoss, quote)} / ${formatPercent(
    balance.profitLossRate,
  )}`;
}

function formatBalanceQuantity(
  value: string | number | undefined,
  currency: string,
  quote: string,
): string {
  if (currency === quote) return formatCryptoAmount(value, quote);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const abs = Math.abs(numeric);
  if (abs === 0) return '0';
  if (abs < 0.000001) return '0.000001 미만';
  if (abs >= 1) return formatCryptoDecimal(value, { maxFractionDigits: 4 });
  return formatCryptoDecimal(value, { maxFractionDigits: 6 });
}

export const CryptoOrdersPanel = ({
  cancelPending,
  detail,
  detailLoading,
  enabled,
  onCloseDetail,
  onCancel,
  onOpenDetail,
  orders,
  title = '주문',
}: {
  cancelPending: boolean;
  detail: CryptoOrderDetail | null;
  detailLoading: boolean;
  enabled: boolean;
  onCloseDetail: () => void;
  onCancel: (uuid: string) => void;
  onOpenDetail: (uuid: string) => void;
  orders: Array<{
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
  }>;
  title?: string;
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">{title}</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <>
        <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
          <TableGrid.Header>
            <TableGrid.Cell width="9rem">마켓</TableGrid.Cell>
            <TableGrid.Cell width="4.5rem">방향</TableGrid.Cell>
            <TableGrid.Cell width="6rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="9rem" numeric>
              평균가
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              체결
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              잔량
            </TableGrid.Cell>
            <TableGrid.Cell width="7rem" numeric>
              수수료
            </TableGrid.Cell>
            <TableGrid.Cell width="10rem">관리</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {orders.map((order) => (
              <TableGrid.Row key={order.id}>
                <TableGrid.Cell width="9rem">{order.market}</TableGrid.Cell>
                <TableGrid.Cell
                  width="4.5rem"
                  className={order.side === 'bid' ? 'num-up' : 'num-down'}
                >
                  {order.side === 'bid' ? '매수' : '매도'}
                </TableGrid.Cell>
                <TableGrid.Cell width="6rem">{stateLabel(order.state)}</TableGrid.Cell>
                <TableGrid.Cell width="9rem" numeric>
                  {formatCryptoPrice(order.price ?? undefined, order.market)}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {formatCryptoVolume(order.executedVolume)}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {formatCryptoVolume(order.remainingVolume)}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem" numeric>
                  {formatCryptoVolume(order.paidFee)}
                </TableGrid.Cell>
                <TableGrid.Cell width="10rem">
                  {order.uuid ? (
                    <Button dense onClick={() => onOpenDetail(order.uuid as string)}>
                      상세
                    </Button>
                  ) : null}
                  {isOpenOrder(order.state) && order.uuid ? (
                    <Button
                      dense
                      disabled={cancelPending}
                      onClick={() => onCancel(order.uuid as string)}
                    >
                      취소
                    </Button>
                  ) : null}
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {orders.length === 0 ? (
              <TableGrid.Row placeholder>
                <TableGrid.Cell width="100%" className="muted">
                  {title} 내역이 없습니다.
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
          </TableGrid.Body>
        </TableGrid.Root>
        {detail || detailLoading ? (
          <CryptoOrderDetailModal detail={detail} loading={detailLoading} onClose={onCloseDetail} />
        ) : null}
      </>
    )}
  </section>
);

const CryptoOrderDetailModal = ({
  detail,
  loading,
  onClose,
}: {
  detail: CryptoOrderDetail | null;
  loading: boolean;
  onClose: () => void;
}): ReactElement => (
  <div className="crypto-detail-modal" role="dialog" aria-label="주문 상세">
    <div className="crypto-detail-modal__content">
      <div className="panel__title">
        주문 상세
        <Button dense onClick={onClose}>
          닫기
        </Button>
      </div>
      {loading && !detail ? (
        <div className="panel__body muted">상세 로드 중…</div>
      ) : detail ? (
        <div className="panel__body crypto-detail-modal__body">
          <div className="crypto-detail-modal__summary">
            <span>{detail.market}</span>
            <span className={detail.side === 'bid' ? 'num-up' : 'num-down'}>
              {detail.side === 'bid' ? '매수' : '매도'} · {stateLabel(detail.state)}
            </span>
            <span>평균 {formatCryptoPrice(detail.averageExecutedPrice, detail.market)}</span>
            <span>체결 {formatCryptoVolume(detail.executedVolume)}</span>
            <span>잔량 {formatCryptoVolume(detail.remainingVolume)}</span>
            <span>수수료 {formatCryptoVolume(detail.totalFee)}</span>
          </div>
          <TableGrid.Root
            variant="hts"
            stickyHeader
            horizontalScroll
            style={{ maxHeight: '18rem' }}
          >
            <TableGrid.Header>
              <TableGrid.Cell width="9rem">시각</TableGrid.Cell>
              <TableGrid.Cell width="10rem" numeric>
                가격
              </TableGrid.Cell>
              <TableGrid.Cell width="9rem" numeric>
                수량
              </TableGrid.Cell>
              <TableGrid.Cell width="10rem" numeric>
                체결금액
              </TableGrid.Cell>
              <TableGrid.Cell width="8rem" numeric>
                수수료
              </TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {detail.trades.length === 0 ? (
                <TableGrid.Row placeholder>
                  <TableGrid.Cell width="100%" className="muted">
                    체결 내역 없음
                  </TableGrid.Cell>
                </TableGrid.Row>
              ) : (
                detail.trades.map((trade) => (
                  <TableGrid.Row key={trade.uuid}>
                    <TableGrid.Cell width="9rem">{formatDateTime(trade.createdAt)}</TableGrid.Cell>
                    <TableGrid.Cell width="10rem" numeric>
                      {formatCryptoPrice(trade.price, detail.market)}
                    </TableGrid.Cell>
                    <TableGrid.Cell width="9rem" numeric>
                      {formatCryptoVolume(trade.volume)}
                    </TableGrid.Cell>
                    <TableGrid.Cell width="10rem" numeric>
                      {formatCryptoAmount(trade.funds, detail.market)}
                    </TableGrid.Cell>
                    <TableGrid.Cell width="8rem" numeric>
                      {formatCryptoVolume(trade.fee)}
                    </TableGrid.Cell>
                  </TableGrid.Row>
                ))
              )}
            </TableGrid.Body>
          </TableGrid.Root>
        </div>
      ) : null}
    </div>
  </div>
);

export const CryptoTransfersPanel = ({
  enabled,
  onCloseDetail,
  onOpenDetail,
  selectedTransfer,
  transferDetailLoading,
  transfers,
  walletStatuses,
}: {
  enabled: boolean;
  onCloseDetail: () => void;
  onOpenDetail: (transfer: CryptoTransferStatus) => void;
  selectedTransfer: CryptoTransferStatus | null;
  transferDetailLoading: boolean;
  transfers: CryptoTransferStatus[];
  walletStatuses: CryptoWalletStatus[];
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-transfer-panel">
    <div className="panel__title">입출금 현황</div>
    {!enabled ? (
      <div className="panel__body muted">활성 Upbit 실전 계좌에서만 조회됩니다.</div>
    ) : (
      <>
        <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
          <TableGrid.Header>
            <TableGrid.Cell width="5rem">구분</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자산</TableGrid.Cell>
            <TableGrid.Cell width="7rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="9rem" numeric>
              수량
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              수수료
            </TableGrid.Cell>
            <TableGrid.Cell width="10rem">완료</TableGrid.Cell>
            <TableGrid.Cell width="6rem">상세</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {transfers.map((transfer) => (
              <TableGrid.Row key={`${transfer.direction}:${transfer.uuid}`}>
                <TableGrid.Cell width="5rem">
                  {transferDirectionLabel(transfer.direction)}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {transfer.currency}
                  {transfer.netType ? `/${transfer.netType}` : ''}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">{transfer.state}</TableGrid.Cell>
                <TableGrid.Cell width="9rem" numeric>
                  {formatCryptoVolume(transfer.amount)}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {formatCryptoVolume(transfer.fee)}
                </TableGrid.Cell>
                <TableGrid.Cell width="10rem">{formatDateTime(transfer.doneAt)}</TableGrid.Cell>
                <TableGrid.Cell width="6rem">
                  <Button dense onClick={() => onOpenDetail(transfer)}>
                    상세
                  </Button>
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {transfers.length === 0 ? (
              <TableGrid.Row placeholder>
                <TableGrid.Cell width="100%" className="muted">
                  입출금 내역이 없습니다.
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
          </TableGrid.Body>
        </TableGrid.Root>
        <div className="panel__body crypto-wallet-status-strip">
          {walletStatuses.slice(0, 6).map((status) => (
            <span
              key={`${status.currency}:${status.netType}`}
              className={status.walletState === 'working' ? 'chip chip--live' : 'chip'}
            >
              {status.currency}/{status.netType} {status.walletState}
            </span>
          ))}
        </div>
        {selectedTransfer || transferDetailLoading ? (
          <CryptoTransferDetailModal
            loading={transferDetailLoading}
            onClose={onCloseDetail}
            transfer={selectedTransfer}
          />
        ) : null}
      </>
    )}
  </section>
);

const CryptoTransferDetailModal = ({
  loading,
  onClose,
  transfer,
}: {
  loading: boolean;
  onClose: () => void;
  transfer: CryptoTransferStatus | null;
}): ReactElement => (
  <div className="crypto-detail-modal" role="dialog" aria-label="입출금 상세">
    <div className="crypto-detail-modal__content">
      <div className="panel__title">
        입출금 상세
        <Button dense onClick={onClose}>
          닫기
        </Button>
      </div>
      {loading && !transfer ? (
        <div className="panel__body muted">상세 로드 중…</div>
      ) : transfer ? (
        <div className="panel__body crypto-detail-modal__body">
          <div className="crypto-detail-modal__summary">
            <span>{transferDirectionLabel(transfer.direction)}</span>
            <span>
              {transfer.currency}
              {transfer.netType ? `/${transfer.netType}` : ''}
            </span>
            <span>{transfer.state}</span>
            <span>수량 {formatCryptoVolume(transfer.amount)}</span>
            <span>수수료 {formatCryptoVolume(transfer.fee)}</span>
          </div>
          <dl className="crypto-detail-modal__fields">
            <div>
              <dt>UUID</dt>
              <dd className="num">{transfer.uuid}</dd>
            </div>
            <div>
              <dt>요청</dt>
              <dd>{formatDateTime(transfer.createdAt)}</dd>
            </div>
            <div>
              <dt>완료</dt>
              <dd>{formatDateTime(transfer.doneAt)}</dd>
            </div>
            <div>
              <dt>구분</dt>
              <dd>{transfer.transferType || transfer.transactionType || '-'}</dd>
            </div>
            <div>
              <dt>TX</dt>
              <dd className="num">{transfer.txid ?? '-'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  </div>
);
