import { TableGrid } from '@renderer/shared/ui';
import type { CSSProperties, ReactElement } from 'react';
import {
  decimalGt,
  decimalRatioPercent,
  formatCryptoPrice,
  formatCryptoVolume,
} from '../model/crypto-format';

type Side = 'bid' | 'ask';

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
            <TableGrid.Cell
              flex={1}
              numeric
              style={{ justifyContent: 'center', minWidth: 'calc(13ch + 1rem)' }}
            >
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
      <TableGrid.Cell
        flex={1}
        numeric
        className={side === 'ask' ? 'num-down' : 'num-up'}
        style={{ justifyContent: 'center', minWidth: 'calc(13ch + 1rem)' }}
      >
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
