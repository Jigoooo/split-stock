import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, TableGrid } from '@renderer/shared/ui';
import { type NormalizedOrder, OrdersPanel } from '@renderer/widgets/orders-panel';
import type { CryptoOrderDetail } from '@shared/contracts';
import { type ReactElement, useMemo } from 'react';
import { formatCryptoAmount, formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { formatDateTime, isOpenOrder, stateLabel } from '../model/crypto-formatters';

const CRYPTO_ORDER_COLUMNS = [
  'symbol',
  'side',
  'state',
  'price',
  'executed',
  'remaining',
  'fee',
  'manage',
] as const;

interface CryptoOrderRow {
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

/**
 * 코인 주문 패널 — broker-agnostic OrdersPanel 위 wrapper.
 *
 * UPBIT-specific 처리는 모두 wrapper 에서 흡수:
 *   - DecimalString → Number 변환 (executedVolume, remainingVolume, paidFee, price 등)
 *   - bid/ask → BUY/SELL 정규화
 *   - state 라벨 (wait/watch/done/cancel → 한국어)
 *   - uuid 가 null 인 행은 cancel/detail 버튼 숨김 (cancellable=false)
 *
 * OrdersPanel base 는 NormalizedOrder shape 만 받음 — DecimalString 이 base 에 새지 않음.
 */
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
  orders: Array<CryptoOrderRow>;
  title?: string;
}): ReactElement => {
  const resolvedTitle = `${title} (${thousandSeparator(orders.length)}건)`;

  const normalized = useMemo<NormalizedOrder[]>(
    () =>
      orders.map((order) => {
        const isOpen = isOpenOrder(order.state);
        const volumeNum = order.volume !== null ? Number(order.volume) : 0;
        const remainingNum = Number(order.remainingVolume);
        const executedNum = Number(order.executedVolume);
        const priceNum = order.price !== null ? Number(order.price) : 0;
        const cancellable = isOpen && order.uuid !== null;
        const id = order.uuid ?? `crypto-order-${order.id}`;
        return {
          id,
          symbol: order.market,
          symbolLabel: order.market,
          side: order.side === 'bid' ? 'BUY' : 'SELL',
          qty: Number.isFinite(volumeNum) ? volumeNum : 0,
          remainingQty: Number.isFinite(remainingNum) ? remainingNum : 0,
          filledQty: Number.isFinite(executedNum) ? executedNum : 0,
          price: Number.isFinite(priceNum) ? priceNum : 0,
          priceLabel: formatCryptoPrice(order.price ?? undefined, order.market),
          executedLabel: formatCryptoVolume(order.executedVolume),
          remainingLabel: formatCryptoVolume(order.remainingVolume),
          feeLabel: formatCryptoVolume(order.paidFee),
          stateLabel: stateLabel(order.state),
          stateVariant: isOpen ? 'neutral' : 'up',
          placedAt: 0,
          cancellable,
          raw: order,
        };
      }),
    [orders],
  );

  if (!enabled) {
    return (
      <OrdersPanel
        mode="active"
        title={resolvedTitle}
        columns={CRYPTO_ORDER_COLUMNS}
        orders={[]}
        disabledPlaceholder="활성 Upbit 실전 계좌에서만 조회됩니다."
      />
    );
  }

  const handleCancel = (id: string): void => {
    // uuid 가 null 이면 cancellable=false 로 차단됐으므로 여기는 항상 uuid.
    if (id.startsWith('crypto-order-')) return;
    onCancel(id);
  };

  const handleDetail = (id: string): void => {
    if (id.startsWith('crypto-order-')) return;
    onOpenDetail(id);
  };

  return (
    <OrdersPanel
      mode="active"
      title={resolvedTitle}
      tableAriaLabel={`${title} 테이블`}
      columns={CRYPTO_ORDER_COLUMNS}
      orders={normalized}
      onCancel={handleCancel}
      onOpenDetail={handleDetail}
      cancelPending={cancelPending}
      emptyText={`${title} 내역이 없습니다.`}
      footerSlot={
        detail || detailLoading ? (
          <CryptoOrderDetailModal detail={detail} loading={detailLoading} onClose={onCloseDetail} />
        ) : null
      }
    />
  );
};

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
