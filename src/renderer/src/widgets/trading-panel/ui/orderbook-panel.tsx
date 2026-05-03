import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import { type CSSProperties, type ReactElement, useRef } from 'react';
import type { LiveOrderbook, WsRoutingMode } from '../model/use-live-feed';

export interface OrderbookPanelProps {
  orderbook: LiveOrderbook | null;
  currentPrice: number;
  onClickPrice: (price: number, side: 'BUY' | 'SELL') => void;
  /**
   * WS/REST 라우팅 모드 — 'POLLING' 시 "폴링 중" 칩 표시.
   * 미주입 시 인디케이터 숨김 (BC).
   */
  routingMode?: WsRoutingMode;
}

const RoutingIndicator = ({ mode }: { mode: WsRoutingMode }): ReactElement | null => {
  if (mode === 'POLLING') {
    return (
      <span className="chip chip--down" data-testid="orderbook-routing-polling">
        폴링 중
      </span>
    );
  }
  return null;
};

const ORDERBOOK_QTY_BASE_CHARS = 12;
// 코인 KRW 마켓 (예: 116,638,000 = 11char) 도 짤림 없이 표시되도록 base 13 으로 상향.
// '0' 글리프 폭 기준 ch 단위는 컴마/숫자 혼합 텍스트 실폭과 ±1ch 오차가 발생할 수 있어 여유 확보.
const ORDERBOOK_PRICE_BASE_CHARS = 13;
const ORDERBOOK_CELL_EXTRA_WIDTH_REM = 1;

const getLongestFormattedLength = (values: number[], minChars: number): number =>
  values.reduce((max, value) => Math.max(max, thousandSeparator(value).length), minChars);

const toColumnMinWidth = (chars: number): string =>
  `calc(${chars}ch + ${ORDERBOOK_CELL_EXTRA_WIDTH_REM}rem)`;

export const ORDERBOOK_PANEL_MIN_WIDTH = `calc(${
  ORDERBOOK_QTY_BASE_CHARS * 2 + ORDERBOOK_PRICE_BASE_CHARS
}ch + ${ORDERBOOK_CELL_EXTRA_WIDTH_REM * 3}rem)`;

const measureOrderbookLayoutChars = (
  orderbook: LiveOrderbook,
): {
  qtyChars: number;
  priceChars: number;
} => ({
  qtyChars: getLongestFormattedLength(
    [...orderbook.asks, ...orderbook.bids].map((level) => level.quantity),
    ORDERBOOK_QTY_BASE_CHARS,
  ),
  priceChars: getLongestFormattedLength(
    [...orderbook.asks, ...orderbook.bids].map((level) => level.price),
    ORDERBOOK_PRICE_BASE_CHARS,
  ),
});

const getOrderbookLayoutStyles = (chars: {
  qtyChars: number;
  priceChars: number;
}): {
  qtyCellStyle: CSSProperties;
  priceCellStyle: CSSProperties;
} => {
  return {
    qtyCellStyle: { minWidth: toColumnMinWidth(chars.qtyChars) },
    priceCellStyle: { minWidth: toColumnMinWidth(chars.priceChars) },
  };
};

/**
 * 10단 호가창 — 매도(상단 10단) + 현재가 + 매수(하단 10단).
 * - 각 행 클릭 시 onClickPrice(price, side) 호출 → order-ticket prefill
 * - 잔량 bar: max 잔량 대비 상대 길이
 * - 한국식 색상 (매수 row=up 빨강, 매도 row=down 파랑)
 * - routingMode='POLLING' 이면 우측 상단에 "폴링 중" 칩 노출 (WS 한도 초과)
 */
export const OrderbookPanel = (props: OrderbookPanelProps): ReactElement => {
  const { orderbook, currentPrice, onClickPrice, routingMode } = props;
  const layoutCharsRef = useRef<{
    pdno: string | null;
    qtyChars: number;
    priceChars: number;
  }>({
    pdno: null,
    qtyChars: ORDERBOOK_QTY_BASE_CHARS,
    priceChars: ORDERBOOK_PRICE_BASE_CHARS,
  });

  if (!orderbook) {
    return (
      <div className="panel">
        <div
          className="panel__body"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span className="muted">호가 로드 중…</span>
          {routingMode ? <RoutingIndicator mode={routingMode} /> : null}
        </div>
      </div>
    );
  }
  const maxQty = Math.max(
    1,
    ...orderbook.asks.map((l) => l.quantity),
    ...orderbook.bids.map((l) => l.quantity),
  );
  // 매도는 10→1로 내려오게 역순 표시 (HTS 관례: 매도 위/매수 아래, 매도 1단이 아래에 붙음)
  const asksReversed = [...orderbook.asks].reverse();
  const measuredChars = measureOrderbookLayoutChars(orderbook);

  if (layoutCharsRef.current.pdno !== orderbook.pdno) {
    layoutCharsRef.current = { pdno: orderbook.pdno, ...measuredChars };
  } else {
    layoutCharsRef.current.qtyChars = Math.max(
      layoutCharsRef.current.qtyChars,
      measuredChars.qtyChars,
    );
    layoutCharsRef.current.priceChars = Math.max(
      layoutCharsRef.current.priceChars,
      measuredChars.priceChars,
    );
  }

  const { qtyCellStyle, priceCellStyle } = getOrderbookLayoutStyles(layoutCharsRef.current);

  return (
    <div className="panel orderbook-panel">
      <div className="orderbook-panel__scroll">
        <TableGrid.Root
          variant="hts"
          className="orderbook-grid"
          stickyHeader
          horizontalScroll
          zebra={false}
          aria-label="호가 10단"
          style={{ '--hts-row-height': '18px', width: '100%' } as CSSProperties}
        >
          <TableGrid.Header>
            <TableGrid.Cell
              flex={2}
              numeric
              style={{ ...qtyCellStyle, justifyContent: 'flex-end' }}
            >
              매도잔량
            </TableGrid.Cell>
            <TableGrid.Cell
              flex={1}
              numeric
              style={{ ...priceCellStyle, justifyContent: 'center' }}
            >
              호가
            </TableGrid.Cell>
            <TableGrid.Cell flex={2} numeric style={qtyCellStyle}>
              매수잔량
            </TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {asksReversed.map((l, idx) => (
              <OrderbookRow
                // biome-ignore lint/suspicious/noArrayIndexKey: orderbook은 고정 10단계 — level idx가 안정 식별자
                key={`ask-level-${idx}`}
                leftQty={l.quantity}
                rightQty={0}
                price={l.price}
                maxQty={maxQty}
                qtyCellStyle={qtyCellStyle}
                priceCellStyle={priceCellStyle}
                side="SELL"
                current={l.price === currentPrice}
                onClick={() => onClickPrice(l.price, 'BUY')}
              />
            ))}
            {orderbook.bids.map((l, idx) => (
              <OrderbookRow
                // biome-ignore lint/suspicious/noArrayIndexKey: orderbook은 고정 10단계 — level idx가 안정 식별자
                key={`bid-level-${idx}`}
                leftQty={0}
                rightQty={l.quantity}
                price={l.price}
                maxQty={maxQty}
                qtyCellStyle={qtyCellStyle}
                priceCellStyle={priceCellStyle}
                side="BUY"
                current={l.price === currentPrice}
                onClick={() => onClickPrice(l.price, 'SELL')}
              />
            ))}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>
      <div
        className="panel__body"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          overflow: 'hidden',
        }}
      >
        <span
          className="muted"
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
        >
          총 매도 {thousandSeparator(orderbook.totalAskQty)} · 총 매수{' '}
          {thousandSeparator(orderbook.totalBidQty)}
        </span>
        {routingMode === 'POLLING' ? <RoutingIndicator mode={routingMode} /> : null}
      </div>
    </div>
  );
};

interface RowProps {
  leftQty: number;
  rightQty: number;
  price: number;
  maxQty: number;
  qtyCellStyle: CSSProperties;
  priceCellStyle: CSSProperties;
  side: 'BUY' | 'SELL';
  current: boolean;
  onClick: () => void;
}

const OrderbookRow = ({
  leftQty,
  rightQty,
  price,
  maxQty,
  qtyCellStyle,
  priceCellStyle,
  side,
  current,
  onClick,
}: RowProps): ReactElement => {
  const leftPct = Math.round((leftQty / maxQty) * 100);
  const rightPct = Math.round((rightQty / maxQty) * 100);
  const priceColorClass = side === 'SELL' ? 'num-down' : 'num-up';
  return (
    <TableGrid.Row
      className={[
        'orderbook-row',
        `orderbook-row--${side.toLowerCase()}`,
        current ? 'orderbook-row--current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      {/* 매도잔량 — bar 오른쪽 정렬 */}
      <TableGrid.Cell
        flex={2}
        numeric
        style={{ ...qtyCellStyle, position: 'relative', justifyContent: 'flex-end' }}
      >
        {leftQty > 0 ? (
          <>
            <span
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: `${leftPct}%`,
                background: 'rgba(45, 79, 202, 0.18)',
              }}
            />
            <span style={{ position: 'relative' }}>{thousandSeparator(leftQty)}</span>
          </>
        ) : null}
      </TableGrid.Cell>
      {/* 호가 */}
      <TableGrid.Cell
        flex={1}
        numeric
        className={priceColorClass}
        style={{ ...priceCellStyle, fontWeight: current ? 700 : 500, justifyContent: 'center' }}
      >
        {thousandSeparator(price)}
      </TableGrid.Cell>
      {/* 매수잔량 — bar 왼쪽 정렬 */}
      <TableGrid.Cell flex={2} numeric style={{ ...qtyCellStyle, position: 'relative' }}>
        {rightQty > 0 ? (
          <>
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${rightPct}%`,
                background: 'rgba(215, 51, 51, 0.18)',
              }}
            />
            <span style={{ position: 'relative' }}>{thousandSeparator(rightQty)}</span>
          </>
        ) : null}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
};
