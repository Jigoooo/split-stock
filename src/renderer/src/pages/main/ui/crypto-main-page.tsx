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
import type { CSSProperties, ReactElement } from 'react';
import { useMemo, useState } from 'react';

interface CryptoMainPageProps {
  accountId: number;
}

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';
type OrderType = 'limit' | 'price' | 'market';

function formatDecimal(value: string | undefined): string {
  if (!value) return '-';
  const trimmed = value.trim();
  const sign = trimmed.startsWith('-') ? '-' : '';
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const [whole = '0', fractional = ''] = unsigned.split('.');
  const wholeWithCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const visibleFraction = fractional.slice(0, 8).replace(/0+$/, '');
  return visibleFraction
    ? `${sign}${wholeWithCommas}.${visibleFraction}`
    : `${sign}${wholeWithCommas}`;
}

export const CryptoMainPage = ({ accountId }: CryptoMainPageProps): ReactElement => {
  const utils = trpc.useUtils();
  const [term, setTerm] = useState('KRW-BTC');
  const [market, setMarket] = useState('KRW-BTC');
  const [side, setSide] = useState<Side>('bid');
  const [mode, setMode] = useState<Mode>('limit');
  const [price, setPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [timeInForce, setTimeInForce] = useState('');
  const [smpType, setSmpType] = useState('');

  const marketsQuery = trpc.crypto.listMarkets.useQuery(
    { term, quoteCurrency: 'KRW', limit: 80 },
    { staleTime: 60_000 },
  );
  const tickerQuery = trpc.crypto.getTicker.useQuery(
    { market },
    { enabled: market.length > 0, refetchInterval: 3000 },
  );
  const orderbookQuery = trpc.crypto.getOrderbook.useQuery(
    { market, count: 15 },
    { enabled: market.length > 0, refetchInterval: 1500 },
  );
  const balancesQuery = trpc.crypto.getBalances.useQuery(
    { accountId },
    { staleTime: 5000, refetchInterval: 10_000 },
  );
  const recentOrdersQuery = trpc.crypto.listRecentOrders.useQuery(
    { accountId, limit: 50 },
    { staleTime: 2000 },
  );

  const placeOrder = trpc.crypto.placeOrder.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.crypto.getBalances.invalidate({ accountId }),
        utils.crypto.listRecentOrders.invalidate({ accountId, limit: 50 }),
      ]);
    },
  });

  const selectedMarket = useMemo(
    () => marketsQuery.data?.entries.find((entry) => entry.market === market) ?? null,
    [market, marketsQuery.data?.entries],
  );

  const submit = async (): Promise<void> => {
    const ordType: OrderType = mode === 'market' ? (side === 'bid' ? 'price' : 'market') : 'limit';
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
    market.length > 0 &&
    !placeOrder.isPending &&
    (mode === 'limit'
      ? Number(price) > 0 && Number(volume) > 0
      : side === 'bid'
        ? Number(price) > 0
        : Number(volume) > 0);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        gap: '0.8rem',
        padding: '0.8rem',
      }}
    >
      <div
        className="panel"
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
          onChange={(event) => setMarket(event.target.value)}
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
        <strong>{formatDecimal(tickerQuery.data?.tradePrice)} KRW</strong>
        <span className="muted">24h {formatDecimal(tickerQuery.data?.accTradePrice24h)}</span>
      </div>

      <div
        style={{
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(18rem, 1fr) minmax(22rem, 1.1fr) minmax(20rem, 0.9fr)',
          gap: '0.8rem',
        }}
      >
        <section className="panel" style={{ minHeight: 0, overflow: 'hidden' }}>
          <div className="panel__title">잔고</div>
          <TableGrid.Root variant="hts" stickyHeader={false} style={{ height: '100%' }}>
            <TableGrid.Header>
              <TableGrid.Cell width="5rem">자산</TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                주문가능
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                잠김
              </TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {(balancesQuery.data?.balances ?? []).map((balance) => (
                <TableGrid.Row key={balance.currency}>
                  <TableGrid.Cell width="5rem">{balance.currency}</TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(balance.balance)}
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(balance.locked)}
                  </TableGrid.Cell>
                </TableGrid.Row>
              ))}
            </TableGrid.Body>
          </TableGrid.Root>
        </section>

        <section className="panel" style={{ minHeight: 0, overflow: 'hidden' }}>
          <div className="panel__title">호가</div>
          <TableGrid.Root variant="hts" stickyHeader={false} style={{ height: '100%' }}>
            <TableGrid.Header>
              <TableGrid.Cell flex={1} numeric>
                매도수량
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                매도가
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                매수가
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} numeric>
                매수수량
              </TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {(orderbookQuery.data?.levels ?? []).map((level) => (
                <TableGrid.Row key={`${level.askPrice}:${level.bidPrice}`}>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(level.askSize)}
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(level.askPrice)}
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(level.bidPrice)}
                  </TableGrid.Cell>
                  <TableGrid.Cell flex={1} numeric>
                    {formatDecimal(level.bidSize)}
                  </TableGrid.Cell>
                </TableGrid.Row>
              ))}
            </TableGrid.Body>
          </TableGrid.Root>
        </section>

        <section
          className="panel"
          style={{
            minHeight: 0,
            overflow: 'hidden',
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr',
          }}
        >
          <div className="panel__title">주문</div>
          <div className="panel__body" style={{ display: 'grid', gap: '0.55rem' }}>
            <SegmentedToggle
              ariaLabel="매수 매도"
              value={side}
              onChange={setSide}
              dense
              items={[
                { value: 'bid', label: '매수' },
                { value: 'ask', label: '매도' },
              ]}
            />
            <SegmentedToggle
              ariaLabel="주문 유형"
              value={mode}
              onChange={setMode}
              dense
              items={[
                { value: 'limit', label: '지정가' },
                { value: 'market', label: '시장가' },
              ]}
            />
            <TextInput
              aria-label={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ''))}
              placeholder={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
              dense
              disabled={mode === 'market' && side === 'ask'}
            />
            <TextInput
              aria-label="수량"
              value={volume}
              onChange={(event) => setVolume(event.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="수량"
              dense
              disabled={mode === 'market' && side === 'bid'}
            />
            <Checkbox
              checked={advancedOpen}
              onChange={(event) => setAdvancedOpen(event.currentTarget.checked)}
              label="고급 주문 옵션"
            />
            {advancedOpen ? (
              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <Select
                  aria-label="Time in force"
                  value={timeInForce}
                  onChange={(event) => setTimeInForce(event.target.value)}
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
                  onChange={(event) => setSmpType(event.target.value)}
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
            {placeOrder.error ? (
              <span className="chip chip--down">{placeOrder.error.message}</span>
            ) : null}
            <Button
              variant={side === 'bid' ? 'primary' : 'destructive'}
              loading={placeOrder.isPending}
              loadingText="전송 중…"
              disabled={!canSubmit}
              onClick={() => {
                void submit();
              }}
              dense
            >
              {side === 'bid' ? '매수' : '매도'}
            </Button>
          </div>
          <TableGrid.Root
            variant="hts"
            stickyHeader={false}
            style={{ height: '100%', '--hts-row-height': '2.6rem' } as CSSProperties}
          >
            <TableGrid.Header>
              <TableGrid.Cell flex={1}>마켓</TableGrid.Cell>
              <TableGrid.Cell width="4rem">방향</TableGrid.Cell>
              <TableGrid.Cell width="5rem">상태</TableGrid.Cell>
            </TableGrid.Header>
            <TableGrid.Body>
              {(recentOrdersQuery.data?.orders ?? []).map((order) => (
                <TableGrid.Row key={order.id}>
                  <TableGrid.Cell flex={1}>{order.market}</TableGrid.Cell>
                  <TableGrid.Cell width="4rem">
                    {order.side === 'bid' ? '매수' : '매도'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width="5rem">{order.state}</TableGrid.Cell>
                </TableGrid.Row>
              ))}
            </TableGrid.Body>
          </TableGrid.Root>
        </section>
      </div>
    </div>
  );
};
