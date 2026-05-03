import { Button, TableGrid } from '@renderer/shared/ui';
import type { CryptoOrderDetail } from '@shared/contracts';
import type { ReactElement } from 'react';
import { formatCryptoAmount, formatCryptoPrice, formatCryptoVolume } from '../model/crypto-format';
import { formatDateTime, isOpenOrder, stateLabel } from '../model/crypto-formatters';

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
