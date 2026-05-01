import {
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
import type { CryptoCandleUnit, CryptoRealtimeSessionStatus } from '@shared/contracts';
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CryptoChartPanel } from './crypto-chart-panel';

interface CryptoMainPageProps {
  accountId: number;
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';

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
            tickerFallback={tickerSubscription.status === 'error'}
            tradeTimestamp={liveTrades[0]?.timestamp ?? null}
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
              market={market}
              orderbook={orderbook}
              onPickPrice={(nextPrice) => {
                setPrice(nextPrice);
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
        <CryptoBalancesPanel
          balances={balancesQuery.data?.balances ?? []}
          enabled={privateEnabled}
          quote={quote}
        />
        <CryptoOrdersPanel
          cancelPending={cancelOrder.isPending}
          enabled={privateEnabled}
          onCancel={(uuid) => {
            cancelOrder.mutate({ accountId, uuid });
          }}
          orders={recentOrdersQuery.data?.orders ?? []}
        />
      </div>
    </div>
  );
};

const CryptoRealtimeStatus = ({
  market,
  orderbookFallback,
  privateStatus,
  publicStatus,
  tickerFallback,
  tradeTimestamp,
}: {
  market: string;
  orderbookFallback: boolean;
  privateStatus: CryptoRealtimeSessionStatus | null;
  publicStatus: CryptoRealtimeSessionStatus | null;
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
      {publicStatus?.lastError ? <span className="num-down">{publicStatus.lastError}</span> : null}
      <span style={{ flex: 1 }} />
      <span className="muted">
        최근 체결 {tradeTimestamp ? formatTradeTime(tradeTimestamp) : '대기'}
      </span>
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

const CryptoOrderbookPanel = ({
  market,
  onPickPrice,
  orderbook,
}: {
  market: string;
  onPickPrice: (price: string) => void;
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
              <TableGrid.Row
                // biome-ignore lint/suspicious/noArrayIndexKey: Upbit 호가 레벨은 응답 순서가 레벨 식별자다.
                key={`ask-${index}`}
                className="orderbook-row"
                onClick={() => onPickPrice(level.askPrice)}
              >
                <TableGrid.Cell flex={1} numeric className="num-down">
                  {formatCryptoVolume(level.askSize)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="num-down">
                  {formatCryptoPrice(level.askPrice, market)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="muted">
                  -
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {orderbook.levels.map((level, index) => (
              <TableGrid.Row
                // biome-ignore lint/suspicious/noArrayIndexKey: Upbit 호가 레벨은 응답 순서가 레벨 식별자다.
                key={`bid-${index}`}
                className="orderbook-row"
                onClick={() => onPickPrice(level.bidPrice)}
              >
                <TableGrid.Cell flex={1} numeric className="muted">
                  -
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="num-up">
                  {formatCryptoPrice(level.bidPrice, market)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric className="num-up">
                  {formatCryptoVolume(level.bidSize)}
                </TableGrid.Cell>
              </TableGrid.Row>
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

const CryptoBalancesPanel = ({
  balances,
  enabled,
  quote,
}: {
  balances: Array<{ avgBuyPrice: string; balance: string; currency: string; locked: string }>;
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
        </TableGrid.Header>
        <TableGrid.Body>
          {balances.map((balance) => (
            <TableGrid.Row key={balance.currency}>
              <TableGrid.Cell width="7rem">{balance.currency}</TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoVolume(balance.balance)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoVolume(balance.locked)}
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                {formatCryptoAmount(balance.avgBuyPrice, quote)}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);

const CryptoOrdersPanel = ({
  cancelPending,
  enabled,
  onCancel,
  orders,
}: {
  cancelPending: boolean;
  enabled: boolean;
  onCancel: (uuid: string) => void;
  orders: Array<{
    id: number;
    market: string;
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
      <TableGrid.Root variant="hts" stickyHeader horizontalScroll style={{ height: '100%' }}>
        <TableGrid.Header>
          <TableGrid.Cell width="9rem">마켓</TableGrid.Cell>
          <TableGrid.Cell width="4.5rem">방향</TableGrid.Cell>
          <TableGrid.Cell width="6rem">상태</TableGrid.Cell>
          <TableGrid.Cell width="9rem" numeric>
            가격
          </TableGrid.Cell>
          <TableGrid.Cell width="9rem" numeric>
            잔량
          </TableGrid.Cell>
          <TableGrid.Cell width="6rem">관리</TableGrid.Cell>
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
              <TableGrid.Cell width="6rem">{order.state}</TableGrid.Cell>
              <TableGrid.Cell width="9rem" numeric>
                {formatCryptoPrice(order.price ?? undefined, order.market)}
              </TableGrid.Cell>
              <TableGrid.Cell width="9rem" numeric>
                {formatCryptoVolume(order.remainingVolume)}
              </TableGrid.Cell>
              <TableGrid.Cell width="6rem">
                {isOpenOrder(order.state) && order.uuid ? (
                  <Button
                    dense
                    disabled={cancelPending}
                    onClick={() => onCancel(order.uuid as string)}
                  >
                    취소
                  </Button>
                ) : (
                  <span className="muted">-</span>
                )}
              </TableGrid.Cell>
            </TableGrid.Row>
          ))}
        </TableGrid.Body>
      </TableGrid.Root>
    )}
  </section>
);
