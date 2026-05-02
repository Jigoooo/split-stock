import {
  decimalAdd,
  decimalDiv,
  decimalGt,
  decimalMul,
  decimalRatioPercent,
  decimalSub,
  formatCryptoAmount,
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
  SegmentedToggle,
  Select,
  TableGrid,
  TextInput,
} from '@renderer/shared/ui';
import type {
  CryptoAutoEvent,
  CryptoAutoGateResult,
  CryptoBalanceSummary,
  CryptoCandleUnit,
  CryptoLot,
  CryptoOrderDetail,
  CryptoReadonlySmokeResult,
  CryptoRealtimeSessionStatus,
  CryptoTransferStatus,
  CryptoWalletStatus,
} from '@shared/contracts';
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CryptoChartPanel } from './crypto-chart-panel';

interface CryptoMainPageProps {
  accountId: number;
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';
type AutoMode = 'disabled' | 'dry-run' | 'live-small';

const LIVE_TRADE_LIMIT = 60;

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

export const CryptoMainPage = ({ accountId }: CryptoMainPageProps): ReactElement => {
  const utils = trpc.useUtils();
  const [term, setTerm] = useState('KRW-BTC');
  const [market, setMarket] = useState('KRW-BTC');
  const [unit, setUnit] = useState<CryptoCandleUnit>('1m');
  const [side, setSide] = useState<Side>('bid');
  const [mode, setMode] = useState<Mode>('limit');
  const [price, setPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [timeInForce, setTimeInForce] = useState('');
  const [smpType, setSmpType] = useState('');
  const [selectedOrderUuid, setSelectedOrderUuid] = useState<string | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<{
    direction: CryptoTransferStatus['direction'];
    uuid: string;
  } | null>(null);
  const [autoMode, setAutoMode] = useState<AutoMode>('disabled');
  const [autoEmergencyDisabled, setAutoEmergencyDisabled] = useState(true);
  const [autoBaseOrderKrw, setAutoBaseOrderKrw] = useState('5000');
  const [autoMaxOrderKrw, setAutoMaxOrderKrw] = useState('5000');
  const [autoMaxExposureKrw, setAutoMaxExposureKrw] = useState('50000');
  const [autoTakeProfitPct, setAutoTakeProfitPct] = useState('0.02');
  const [autoAddTriggerPct, setAutoAddTriggerPct] = useState('0.03');
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
  const realtimeStatusQuery = trpc.crypto.getRealtimeStatus.useQuery(undefined, {
    refetchInterval: 2500,
    staleTime: 1500,
  });
  const readonlySmokeQuery = trpc.crypto.runReadonlySmoke.useQuery(
    { accountId, market },
    { enabled: false },
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
    { accountId, uuid: selectedOrderUuid ?? '' },
    { enabled: privateEnabled && selectedOrderUuid !== null, staleTime: 5000 },
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
  const publicRealtimeStatus =
    realtimeStatusQuery.data?.status.publicSessions.find(
      (session) => session.market === market && session.candleUnit === unit,
    ) ?? null;
  const privateRealtimeStatus =
    realtimeStatusQuery.data?.status.privateSessions.find(
      (session) => session.accountId === accountId,
    ) ?? null;
  const quote = getCryptoQuote(market);
  const ordType: OrderType = mode === 'market' ? (side === 'bid' ? 'price' : 'market') : 'limit';
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
  const runAutoDryTick = trpc.crypto.runAutoDryTick.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
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

  useEffect(() => {
    const config = autoStatusQuery.data?.config;
    if (!config) return;
    setAutoMode(config.mode);
    setAutoEmergencyDisabled(config.emergencyDisabled);
    setAutoBaseOrderKrw(config.baseOrderKrw);
    setAutoMaxOrderKrw(config.maxOrderKrw);
    setAutoMaxExposureKrw(config.maxTotalExposureKrw);
    setAutoTakeProfitPct(config.takeProfitPct);
    setAutoAddTriggerPct(config.addTriggerPct);
  }, [autoStatusQuery.data?.config]);

  const submit = async (): Promise<void> => {
    if (priceTickError) return;
    const payload = {
      accountId,
      market,
      side,
      ordType,
      ...(ordType === 'limit' || ordType === 'price' ? { price } : {}),
      ...(ordType === 'limit' || ordType === 'market' ? { volume } : {}),
      ...(advancedOpen && timeInForce
        ? { timeInForce: timeInForce as 'ioc' | 'fok' | 'post_only' }
        : {}),
      ...(advancedOpen && smpType
        ? { smpType: smpType as 'reduce' | 'cancel_maker' | 'cancel_taker' }
        : {}),
    };
    const confirmationPrice = ordType === 'market' ? '-' : price || '-';
    const confirmationVolume = ordType === 'price' ? '-' : volume || '-';
    const confirmed = await dialog.openAsync({
      type: 'WARNING',
      title: `Upbit ${side === 'bid' ? '매수' : '매도'} 확인`,
      confirmText: '주문 전송',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <strong>{market}</strong>
          <span>
            {ordType} · {side === 'bid' ? '매수' : '매도'} · 가격 {confirmationPrice} · 수량{' '}
            {confirmationVolume}
          </span>
        </div>
      ),
    });
    if (!confirmed) return;
    await placeOrder.mutateAsync(payload);
  };

  const canSubmit =
    privateEnabled &&
    market.length > 0 &&
    !placeOrder.isPending &&
    !priceTickError &&
    (mode === 'limit'
      ? Number(price) > 0 && Number(volume) > 0
      : side === 'bid'
        ? Number(price) > 0
        : Number(volume) > 0);

  return (
    <div className="main-bottom-section crypto-main-page">
      <div
        className="panel crypto-market-bar"
        style={{
          padding: '0.7rem',
          display: 'flex',
          gap: '0.6rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <TextInput
          aria-label="코인 검색"
          value={term}
          onChange={(event) => setTerm(event.target.value.toUpperCase())}
          dense
          style={{ width: '14rem' }}
        />
        <Select
          aria-label="마켓 선택"
          value={market}
          onChange={(event) => {
            setMarket(event.target.value);
            setLiveTrades([]);
          }}
          dense
          style={{ width: '16rem' }}
        >
          {(marketsQuery.data?.entries ?? []).map((entry) => (
            <option key={entry.market} value={entry.market}>
              {entry.market} · {entry.koreanName}
            </option>
          ))}
          {selectedMarket === null ? <option value={market}>{market}</option> : null}
        </Select>
        <span className="chip chip--live">UPBIT</span>
        <span className="muted">{selectedMarket?.koreanName ?? market}</span>
        <span style={{ flex: 1 }} />
        <strong className={Number(ticker?.signedChangePrice ?? 0) < 0 ? 'num-down' : 'num-up'}>
          {formatCryptoPrice(ticker?.tradePrice, market)} {quote}
        </strong>
        <span className="muted">
          {formatSignedPrice(ticker?.signedChangePrice, market)} ·{' '}
          {formatPercent(ticker?.signedChangeRate)}
        </span>
        <span
          className={tickerSubscription.status === 'error' ? 'chip chip--down' : 'chip chip--live'}
        >
          {tickerSubscription.status === 'error' ? 'REST 폴백' : '실시간'}
        </span>
      </div>

      <div className="trade-workspace-grid main-bottom-section__content crypto-trade-workspace-grid">
        <CryptoChartPanel
          market={market}
          name={selectedMarket?.koreanName ?? market}
          unit={unit}
          onUnitChange={setUnit}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.8rem',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <CryptoRealtimeStatus
            market={market}
            orderbookFallback={orderbookSubscription.status === 'error'}
            privateStatus={privateRealtimeStatus}
            publicStatus={publicRealtimeStatus}
            smokePending={readonlySmokeQuery.isFetching}
            smokeResult={readonlySmokeQuery.data ?? null}
            tickerFallback={tickerSubscription.status === 'error'}
            tradeTimestamp={liveTrades[0]?.timestamp ?? null}
            onRunSmoke={() => {
              void readonlySmokeQuery.refetch();
            }}
          />
          <div
            className="trading-panel__grid crypto-trading-panel__grid"
            style={
              {
                '--orderbook-panel-min-width': 'minmax(250px, 1fr)',
                '--trade-feed-panel-min-width': '280px',
              } as CSSProperties
            }
          >
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
            <CryptoOrderTicket
              advancedOpen={advancedOpen}
              canSubmit={canSubmit}
              error={priceTickError ?? placeOrder.error?.message ?? null}
              mode={mode}
              onAdvancedOpenChange={setAdvancedOpen}
              onModeChange={setMode}
              onPriceChange={setPrice}
              onSideChange={setSide}
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
            <CryptoTradeFeedPanel market={market} trades={liveTrades} />
          </div>
        </div>
      </div>

      <div className="crypto-account-grid">
        <CryptoAutoPanel
          addTriggerPct={autoAddTriggerPct}
          baseOrderKrw={autoBaseOrderKrw}
          enabled={privateEnabled && market.startsWith('KRW-')}
          emergencyDisabled={autoEmergencyDisabled}
          events={autoStatusQuery.data?.recentEvents ?? []}
          gate={autoStatusQuery.data?.gate ?? { ok: false, blockedReasons: ['상태 로드 전'] }}
          dryRunLots={autoStatusQuery.data?.dryRunLots ?? autoStatusQuery.data?.openLots ?? []}
          lastDryRunAt={autoStatusQuery.data?.config.lastDryRunAt ?? null}
          lastLiveActionAt={autoStatusQuery.data?.config.lastLiveActionAt ?? null}
          lastReadonlySmokeAt={autoStatusQuery.data?.config.lastReadonlySmokeAt ?? null}
          liveLots={autoStatusQuery.data?.liveLots ?? []}
          market={market}
          maxExposureKrw={autoMaxExposureKrw}
          maxOrderKrw={autoMaxOrderKrw}
          mode={autoMode}
          onAddTriggerPctChange={setAutoAddTriggerPct}
          onBaseOrderKrwChange={(value) => setAutoBaseOrderKrw(sanitizeDecimal(value))}
          onEmergencyDisabledChange={setAutoEmergencyDisabled}
          onMaxExposureKrwChange={(value) => setAutoMaxExposureKrw(sanitizeDecimal(value))}
          onMaxOrderKrwChange={(value) => setAutoMaxOrderKrw(sanitizeDecimal(value))}
          onModeChange={setAutoMode}
          onRunDry={() => {
            runAutoDryTick.mutate({ accountId, market });
          }}
          onRunLive={() => {
            void dialog
              .openAsync({
                type: 'WARNING',
                title: '코인 자동매매 live-small 실행',
                confirmText: '소액 live 실행',
                cancelText: '취소',
                isCancelWith: true,
                message: `${market} 자동매매 live-small 1 tick을 실행합니다.`,
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
                baseOrderKrw: autoBaseOrderKrw,
                maxOrderKrw: autoMaxOrderKrw,
                maxTotalExposureKrw: autoMaxExposureKrw,
                addTriggerPct: autoAddTriggerPct,
                takeProfitPct: autoTakeProfitPct,
              },
            });
          }}
          onStart={() => {
            startAuto.mutate({ accountId, market });
          }}
          onStop={() => {
            stopAuto.mutate({ accountId, market });
          }}
          pending={
            saveAutoConfig.isPending ||
            runAutoDryTick.isPending ||
            runAutoLiveTick.isPending ||
            startAuto.isPending ||
            stopAuto.isPending
          }
          quote={quote}
          running={autoStatusQuery.data?.runtimeRunning ?? false}
          takeProfitPct={autoTakeProfitPct}
          onTakeProfitPctChange={setAutoTakeProfitPct}
        />
        <CryptoBalancesPanel balances={balanceSummaries} enabled={privateEnabled} quote={quote} />
        <CryptoOrdersPanel
          cancelPending={cancelOrder.isPending}
          enabled={privateEnabled}
          detail={orderDetailQuery.data?.order ?? null}
          detailLoading={orderDetailQuery.isFetching}
          onCloseDetail={() => setSelectedOrderUuid(null)}
          onCancel={(uuid) => {
            cancelOrder.mutate({ accountId, uuid });
          }}
          onOpenDetail={(uuid) => setSelectedOrderUuid(uuid)}
          orders={recentOrdersQuery.data?.orders ?? []}
        />
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
      </div>
    </div>
  );
};

const CryptoRealtimeStatus = ({
  market,
  onRunSmoke,
  orderbookFallback,
  privateStatus,
  publicStatus,
  smokePending,
  smokeResult,
  tickerFallback,
  tradeTimestamp,
}: {
  market: string;
  onRunSmoke: () => void;
  orderbookFallback: boolean;
  privateStatus: CryptoRealtimeSessionStatus | null;
  publicStatus: CryptoRealtimeSessionStatus | null;
  smokePending: boolean;
  smokeResult: CryptoReadonlySmokeResult | null;
  tickerFallback: boolean;
  tradeTimestamp: number | null;
}): ReactElement => {
  const publicState =
    publicStatus?.state ?? (tickerFallback || orderbookFallback ? 'failed' : 'open');
  const privateState = privateStatus?.state ?? 'closed';
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
        minHeight: '2.4rem',
      }}
    >
      <span className={statusChipClass(publicState)}>
        {tickerFallback || orderbookFallback ? 'REST 폴백' : statusLabel(publicState)}
      </span>
      <span className={statusChipClass(privateState)}>개인 {statusLabel(privateState)}</span>
      <span className="muted">{market} 체결/호가 수신</span>
      {smokeResult ? (
        <span
          className={
            smokeResult.balances.ok && smokeResult.reconciliation.ok ? 'chip' : 'chip chip--down'
          }
        >
          smoke 잔고 {smokeResult.balances.count} · 정합성{' '}
          {smokeResult.reconciliation.ok ? '정상' : '확인필요'}
        </span>
      ) : null}
      {publicStatus?.lastError ? <span className="num-down">{publicStatus.lastError}</span> : null}
      <span style={{ flex: 1 }} />
      <span className="muted">
        최근 체결 {tradeTimestamp ? formatTradeTime(tradeTimestamp) : '대기'}
      </span>
      <Button dense loading={smokePending} loadingText="smoke" onClick={onRunSmoke}>
        읽기 smoke
      </Button>
    </div>
  );
};

function statusLabel(state: CryptoRealtimeSessionStatus['state']): string {
  if (state === 'connecting') return '연결중';
  if (state === 'open') return '실시간';
  if (state === 'stale') return '지연';
  if (state === 'reconnecting') return '재연결';
  if (state === 'failed') return '실패';
  return '종료';
}

function statusChipClass(state: CryptoRealtimeSessionStatus['state']): string {
  if (state === 'open') return 'chip chip--live';
  if (state === 'connecting' || state === 'reconnecting' || state === 'stale') return 'chip';
  return 'chip chip--down';
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
            <TableGrid.Cell flex={1} numeric>
              매도수량
            </TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              호가
            </TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              매수수량
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
            {currentPrice ? (
              <TableGrid.Row className="orderbook-row orderbook-row--current">
                <TableGrid.Cell flex={1} numeric className="muted">
                  현재가
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {formatCryptoPrice(currentPrice, market)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="muted">
                  {formatTradeTime(Date.now())}
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
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
          총 매도 {formatCryptoVolume(orderbook.totalAskSize)} · 총 매수{' '}
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
      <TableGrid.Cell flex={1} numeric className={side === 'ask' ? 'num-down' : 'muted'}>
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
      <TableGrid.Cell flex={1} numeric className={side === 'bid' ? 'num-up' : 'muted'}>
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
  canSubmit,
  error,
  mode,
  onAdvancedOpenChange,
  onModeChange,
  onPriceChange,
  onSideChange,
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
  canSubmit: boolean;
  error: string | null;
  mode: Mode;
  onAdvancedOpenChange: (open: boolean) => void;
  onModeChange: (mode: Mode) => void;
  onPriceChange: (value: string) => void;
  onSideChange: (side: Side) => void;
  onSmpTypeChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onTimeInForceChange: (value: string) => void;
  onVolumeChange: (value: string) => void;
  pending: boolean;
  price: string;
  side: Side;
  smpType: string;
  timeInForce: string;
  volume: string;
}): ReactElement => (
  <section className="panel order-ticket-form">
    <div className="panel__title">주문</div>
    <div className="order-ticket-form__scroll">
      <div className="panel__body order-ticket-form__content">
        <SegmentedToggle
          ariaLabel="매수 매도"
          value={side}
          onChange={onSideChange}
          dense
          items={[
            { value: 'bid', label: '매수' },
            { value: 'ask', label: '매도' },
          ]}
        />
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
        <Button
          variant={side === 'bid' ? 'primary' : 'destructive'}
          loading={pending}
          loadingText="전송 중…"
          disabled={!canSubmit}
          onClick={() => {
            void onSubmit();
          }}
          dense
        >
          {side === 'bid' ? '매수' : '매도'}
        </Button>
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
      </TableGrid.Body>
    </TableGrid.Root>
  </section>
);

export const CryptoAutoPanel = ({
  addTriggerPct,
  baseOrderKrw,
  emergencyDisabled,
  enabled,
  events,
  gate,
  dryRunLots,
  lastDryRunAt,
  lastLiveActionAt,
  lastReadonlySmokeAt,
  liveLots,
  market,
  maxExposureKrw,
  maxOrderKrw,
  mode,
  onAddTriggerPctChange,
  onBaseOrderKrwChange,
  onEmergencyDisabledChange,
  onMaxExposureKrwChange,
  onMaxOrderKrwChange,
  onModeChange,
  onRunDry,
  onRunLive,
  onSave,
  onStart,
  onStop,
  onTakeProfitPctChange,
  pending,
  quote,
  running,
  takeProfitPct,
}: {
  addTriggerPct: string;
  baseOrderKrw: string;
  emergencyDisabled: boolean;
  enabled: boolean;
  events: CryptoAutoEvent[];
  gate: CryptoAutoGateResult;
  dryRunLots: CryptoLot[];
  lastDryRunAt: number | null;
  lastLiveActionAt: number | null;
  lastReadonlySmokeAt: number | null;
  liveLots: CryptoLot[];
  market: string;
  maxExposureKrw: string;
  maxOrderKrw: string;
  mode: AutoMode;
  onAddTriggerPctChange: (value: string) => void;
  onBaseOrderKrwChange: (value: string) => void;
  onEmergencyDisabledChange: (value: boolean) => void;
  onMaxExposureKrwChange: (value: string) => void;
  onMaxOrderKrwChange: (value: string) => void;
  onModeChange: (mode: AutoMode) => void;
  onRunDry: () => void;
  onRunLive: () => void;
  onSave: () => void;
  onStart: () => void;
  onStop: () => void;
  onTakeProfitPctChange: (value: string) => void;
  pending: boolean;
  quote: string;
  running: boolean;
  takeProfitPct: string;
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-auto-panel">
    <div className="panel__title">자동매매</div>
    {!enabled ? (
      <div className="panel__body muted">Upbit KRW 실전 계좌와 KRW 마켓에서만 동작합니다.</div>
    ) : (
      <div className="panel__body crypto-auto-panel__body">
        <div className="crypto-auto-panel__controls">
          <SegmentedToggle
            ariaLabel="코인 자동매매 모드"
            value={mode}
            onChange={onModeChange}
            dense
            items={[
              { value: 'disabled', label: 'OFF' },
              { value: 'dry-run', label: 'Dry' },
              { value: 'live-small', label: 'Live 소액' },
            ]}
          />
          <Checkbox
            checked={emergencyDisabled}
            onChange={(event) => onEmergencyDisabledChange(event.currentTarget.checked)}
            label="비상 중지"
          />
          <span className={running ? 'chip chip--live' : 'chip'}>
            {running ? 'loop running' : 'loop stopped'}
          </span>
          <span className={gate.ok ? 'chip chip--live' : 'chip chip--down'}>
            {gate.ok ? 'live gate 통과' : 'live gate 차단'}
          </span>
        </div>
        <div className="crypto-auto-panel__settings">
          <label htmlFor="crypto-auto-base-order-krw">
            <span className="muted">기본 주문금액</span>
            <TextInput
              id="crypto-auto-base-order-krw"
              aria-label="기본 주문금액"
              dense
              value={baseOrderKrw}
              onChange={(event) => onBaseOrderKrwChange(event.target.value)}
            />
          </label>
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
          <label htmlFor="crypto-auto-add-trigger-pct">
            <span className="muted">추가매수 하락률</span>
            <TextInput
              id="crypto-auto-add-trigger-pct"
              aria-label="추가매수 하락률"
              dense
              value={addTriggerPct}
              onChange={(event) => onAddTriggerPctChange(sanitizeDecimal(event.target.value))}
            />
          </label>
          <label htmlFor="crypto-auto-take-profit-pct">
            <span className="muted">익절률</span>
            <TextInput
              id="crypto-auto-take-profit-pct"
              aria-label="익절률"
              dense
              value={takeProfitPct}
              onChange={(event) => onTakeProfitPctChange(sanitizeDecimal(event.target.value))}
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
          <span>마지막 dry-run {formatDateTime(lastDryRunAt)}</span>
          <span>마지막 live action {formatDateTime(lastLiveActionAt)}</span>
        </div>
        <div className="crypto-auto-panel__actions">
          <Button dense loading={pending} onClick={onSave}>
            설정 저장
          </Button>
          <Button dense disabled={pending} onClick={onRunDry}>
            dry-run 1회
          </Button>
          <Button dense disabled={pending || !gate.ok} variant="destructive" onClick={onRunLive}>
            live-small 1회
          </Button>
          <Button
            dense
            disabled={pending || running || (mode === 'live-small' && !gate.ok)}
            onClick={onStart}
          >
            loop 시작
          </Button>
          <Button dense disabled={pending || !running} onClick={onStop}>
            loop 중지
          </Button>
        </div>
        <div className="crypto-auto-panel__lists">
          <div>
            <strong>Dry-run lots</strong>
            {dryRunLots.length === 0 ? <p className="muted">모의 차수 없음</p> : null}
            {dryRunLots.slice(0, 4).map((lot) => (
              <p key={lot.id}>
                #{lot.sequence} {formatCryptoVolume(lot.quantity)} · 평단{' '}
                {formatCryptoPrice(lot.avgEntryKrw, market)} · 배정{' '}
                {formatCryptoAmount(lot.allocatedKrw, quote)}
              </p>
            ))}
          </div>
          <div>
            <strong>Live lots</strong>
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
    <div className="panel__title">잔고</div>
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
                {formatCryptoVolume(balance.available)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoVolume(balance.locked)}
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
                className={Number(balance.profitLoss) < 0 ? 'num-down' : 'num-up'}
              >
                {formatCryptoAmount(balance.profitLoss, quote)} ·{' '}
                {formatPercent(balance.profitLossRate)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);

export const CryptoOrdersPanel = ({
  cancelPending,
  detail,
  detailLoading,
  enabled,
  onCloseDetail,
  onCancel,
  onOpenDetail,
  orders,
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
}): ReactElement => (
  <section className="panel crypto-account-panel">
    <div className="panel__title">주문</div>
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
                <TableGrid.Row>
                  <TableGrid.Cell width="46rem" className="muted">
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
                    보기
                  </Button>
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
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
        <div className="panel__body crypto-detail-modal__summary">
          <span>{transferDirectionLabel(transfer.direction)}</span>
          <span>
            {transfer.currency}
            {transfer.netType ? `/${transfer.netType}` : ''}
          </span>
          <span>{transfer.state}</span>
          <span>수량 {formatCryptoVolume(transfer.amount)}</span>
          <span>수수료 {formatCryptoVolume(transfer.fee)}</span>
          <span>요청 {formatDateTime(transfer.createdAt)}</span>
          <span>완료 {formatDateTime(transfer.doneAt)}</span>
          <span>TX {transfer.txid ?? '-'}</span>
        </div>
      ) : null}
    </div>
  </div>
);
