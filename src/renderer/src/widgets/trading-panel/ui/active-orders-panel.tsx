import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import { type NormalizedOrder, OrdersPanel } from '@renderer/widgets/orders-panel';
import { type ReactElement, useMemo } from 'react';
import { useActiveOrders } from '../model/use-active-orders';

export interface ActiveOrdersPanelProps {
  /** 표시할 종목 필터 (선택). null이면 전체. */
  pdnoFilter?: string | null;
  /** pdnoFilter에 해당하는 종목명 (선택). 헤더 및 그리드 표시용. */
  nameFilter?: string | null;
}

const ACTIVE_COLUMNS = [
  'select',
  'symbol',
  'side',
  'remaining',
  'price',
  'state',
  'placedAt',
] as const;

/**
 * KIS 미체결 주문 패널 — broker-agnostic OrdersPanel 위 wrapper.
 *
 * KIS 전용 affordance (orgNo 누락 경고, batch cancel) 는 이 wrapper 에서만 합성:
 *   - orgNo 누락 → 행별 `warning` chip 으로 노출 (정정/취소 API 호출 불가 신호)
 *   - cancelMany batch → toolbar `selectionAction` 슬롯에 합성
 *
 * OrdersPanel base 는 broker prop 분기 없이 NormalizedOrder shape 만 소비.
 */
export const ActiveOrdersPanel = (props: ActiveOrdersPanelProps): ReactElement => {
  const { pdnoFilter, nameFilter } = props;
  const { cancelError, cancelPending, cancelSelected, orders, selected, toggle } =
    useActiveOrders(pdnoFilter);

  const normalized = useMemo<NormalizedOrder[]>(
    () =>
      orders.map((o) => {
        // 우선순위: 서버 join name → caller 가 넘긴 nameFilter (필터 활성 시) → pdno
        const name = o.name ?? (nameFilter && o.pdno === pdnoFilter ? nameFilter : null);
        return {
          id: o.odno,
          symbol: o.pdno,
          symbolLabel: name ? `${name} (${o.pdno})` : o.pdno,
          side: o.side === 'BUY' ? 'BUY' : 'SELL',
          qty: o.qty,
          remainingQty: o.remainingQty,
          filledQty: o.filledQty,
          price: o.price,
          priceLabel: o.division === 'MARKET' ? '시장가' : thousandSeparator(o.price),
          stateLabel: o.status === 'PARTIAL' ? '부분체결' : '미체결',
          stateVariant: o.status === 'PARTIAL' ? 'up' : 'neutral',
          // B2: orgNo 누락 시 정정/취소 API 호출 불가 → wrapper 에서 warning chip 합성.
          // exactOptionalPropertyTypes 호환 위해 undefined 일 땐 키 자체를 빼고 spread.
          ...(o.orgNo
            ? {}
            : {
                warning: {
                  label: 'orgNo ✕',
                  title: '원주문번호 누락 — 정정/취소 불가. KIS 잔고에서 직접 확인 필요',
                },
              }),
          placedAt: o.placedAt,
        };
      }),
    [orders, nameFilter, pdnoFilter],
  );

  const title =
    `미체결 주문 (${thousandSeparator(orders.length)}건)` +
    (pdnoFilter ? ` · ${nameFilter ? `${nameFilter} (${pdnoFilter})` : pdnoFilter}` : '');

  const selectionAction = (
    <>
      <Button
        disabled={selected.size === 0 || cancelPending}
        onClick={() => void cancelSelected()}
        dense
      >
        선택 취소 ({thousandSeparator(selected.size)})
      </Button>
      {cancelError ? <span className="chip chip--down">{cancelError}</span> : null}
    </>
  );

  const selectedIds = useMemo(() => new Set(selected), [selected]);

  return (
    <OrdersPanel
      mode="active"
      title={title}
      tableAriaLabel="미체결 주문"
      columns={ACTIVE_COLUMNS}
      orders={normalized}
      selection={{ selectedIds, onToggle: toggle }}
      selectionAction={selectionAction}
      emptyText="미체결 없음"
    />
  );
};
