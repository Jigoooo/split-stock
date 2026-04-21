import type { WatchOrder } from '@renderer/entities/watch-order';
import type { WatchOrderFormPrefill } from '@renderer/features/add-watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import { type ReactElement, useEffectEvent, useMemo, useState } from 'react';

export interface WatchListProps {
  orders: WatchOrder[];
  isPending: boolean;
  error: { message: string } | null;
  /** 우클릭 메뉴에서 일부 액션 활성 여부 (히스토리 탭 등에서는 모두 비활성). */
  allowMutations: boolean;
  /** allowMutations=true 일 때 행 수정 버튼 클릭 시 호출. */
  onEditOrder?: (prefill: WatchOrderFormPrefill) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  ids: number[];
}

/**
 * 자동감시 행 리스트 + 다중 선택 + 우클릭 컨텍스트 메뉴.
 *
 * 액션:
 *   - 시작: PAUSED → WATCHING
 *   - 중지: WATCHING → PAUSED
 *   - 삭제: terminal cancel
 */
export const WatchList = (props: WatchListProps): ReactElement => {
  const { allowMutations, error, isPending, onEditOrder, orders } = props;
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<ContextMenu | null>(null);

  const pauseMutation = trpc.watch.pause.useMutation();
  const resumeMutation = trpc.watch.resume.useMutation();
  const cancelMutation = trpc.watch.cancel.useMutation();
  const mutationPending =
    pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending;

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onContextMenu = useEffectEvent((e: React.MouseEvent, fallbackId: number) => {
    e.preventDefault();
    const ids = selected.size > 0 ? Array.from(selected) : [fallbackId];
    setMenu({ ids, x: e.clientX, y: e.clientY });
  });

  const closeMenu = (): void => setMenu(null);

  const refresh = async (): Promise<void> => {
    setSelected(new Set());
    await utils.watch.list.invalidate();
    await utils.watch.getControlState.invalidate();
    await utils.watch.history.invalidate();
  };

  const onPauseSelected = useEffectEvent(async (ids: number[]) => {
    setMenu(null);
    for (const id of ids) {
      try {
        await pauseMutation.mutateAsync({ id });
      } catch {
        // 개별 실패는 무시 — invalidate 후 새 상태 반영
      }
    }
    await refresh();
  });

  const onResumeSelected = useEffectEvent(async (ids: number[]) => {
    setMenu(null);
    for (const id of ids) {
      try {
        await resumeMutation.mutateAsync({ id });
      } catch {
        // 개별 실패는 무시 — invalidate 후 새 상태 반영
      }
    }
    await refresh();
  });

  const onDeleteSelected = useEffectEvent(async (ids: number[]) => {
    setMenu(null);
    for (const id of ids) {
      try {
        await cancelMutation.mutateAsync({ id });
      } catch {
        // 개별 실패는 무시 — invalidate 후 새 상태 반영
      }
    }
    await refresh();
  });

  const onEditRow = useEffectEvent((order: WatchOrder) => {
    onEditOrder?.({
      existingId: order.id,
      pdno: order.pdno,
      side: order.side,
      comparator: order.comparator,
      targetPrice: order.targetPrice,
      orderType: order.orderType,
      qtyOrAmountMode: order.qtyOrAmountMode,
      ...(order.qty != null ? { qty: order.qty } : {}),
      ...(order.amountKrw != null ? { amountKrw: order.amountKrw } : {}),
      ...(order.expiresAt != null
        ? {
            expiresAtMs:
              order.expiresAt instanceof Date ? order.expiresAt.getTime() : Number(order.expiresAt),
          }
        : {}),
    });
  });

  const selectedRows = useMemo(
    () => (menu ? orders.filter((order) => menu.ids.includes(order.id)) : []),
    [menu, orders],
  );
  const canPause =
    selectedRows.length > 0 && selectedRows.every((order) => order.status === 'WATCHING');
  const canResume =
    selectedRows.length > 0 && selectedRows.every((order) => order.status === 'PAUSED');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {menu ? (
        <button
          type="button"
          aria-label="컨텍스트 메뉴 닫기"
          onClick={closeMenu}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeMenu();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'default',
            zIndex: 999,
            padding: 0,
          }}
        />
      ) : null}
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="자동감시 리스트"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={42} />
          <TableGrid.Cell width={80}>종목</TableGrid.Cell>
          <TableGrid.Cell width={72}>구분</TableGrid.Cell>
          <TableGrid.Cell width={60}>방향</TableGrid.Cell>
          <TableGrid.Cell width={90} numeric>
            목표가
          </TableGrid.Cell>
          <TableGrid.Cell width={90} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={40}>비교</TableGrid.Cell>
          <TableGrid.Cell width={72}>주문</TableGrid.Cell>
          <TableGrid.Cell width={72}>상태</TableGrid.Cell>
          <TableGrid.Cell width={148} className="muted">
            등록
          </TableGrid.Cell>
          <TableGrid.Cell width={120} className="muted">
            실패사유
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {isPending ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
            </TableGrid.Row>
          ) : orders.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">없음</TableGrid.Cell>
            </TableGrid.Row>
          ) : (
            orders.map((order) => (
              <TableGrid.Row
                key={order.id}
                selected={selected.has(order.id)}
                onContextMenu={(e) => onContextMenu(e, order.id)}
                style={{ position: 'relative' }}
              >
                <TableGrid.Cell width={42}>
                  <Checkbox
                    checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)}
                    aria-label={`선택 ${order.id}`}
                    dense
                  />
                </TableGrid.Cell>
                <TableGrid.Cell width={80} numeric>
                  {order.pdno}
                </TableGrid.Cell>
                <TableGrid.Cell width={72}>{order.source}</TableGrid.Cell>
                <TableGrid.Cell width={60}>
                  <span className={order.side === 'BUY' ? 'num-up' : 'num-down'}>{order.side}</span>
                </TableGrid.Cell>
                <TableGrid.Cell width={90} numeric>
                  {thousandSeparator(order.targetPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell width={90} numeric>
                  {order.qtyOrAmountMode === 'QTY'
                    ? thousandSeparator(order.qty ?? 0)
                    : `${thousandSeparator(order.amountKrw ?? 0)}원`}
                </TableGrid.Cell>
                <TableGrid.Cell width={40}>{order.comparator === 'LTE' ? '≤' : '≥'}</TableGrid.Cell>
                <TableGrid.Cell width={72}>{order.orderType}</TableGrid.Cell>
                <TableGrid.Cell width={72}>{statusLabel(order.status)}</TableGrid.Cell>
                <TableGrid.Cell width={148} className="muted">
                  {formatDate(order.createdAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={120} className="muted">
                  {order.lastFailureReason ?? ''}
                </TableGrid.Cell>
                {allowMutations ? (
                  <button
                    type="button"
                    className="watch-list-more-btn"
                    aria-label={`더보기 ${order.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onContextMenu(e, order.id);
                    }}
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'var(--hts-bg, #1a1a2e)',
                      border: '1px solid var(--hts-line, rgba(255,255,255,0.15))',
                      borderRadius: 3,
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      lineHeight: 1,
                      padding: '0.2rem 0.5rem',
                      opacity: 0,
                      transition: 'opacity 0.1s',
                      zIndex: 1,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '0';
                    }}
                  >
                    ···
                  </button>
                ) : null}
              </TableGrid.Row>
            ))
          )}
        </TableGrid.Body>
      </TableGrid.Root>

      {menu ? (
        <div
          data-testid="watch-context-menu"
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            background: 'var(--bg, #fff)',
            border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '0.25rem 0',
            zIndex: 1000,
            minWidth: '8rem',
            fontSize: '1.1rem',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <MenuItem
            disabled={!allowMutations || !canResume || mutationPending}
            label={`시작 (${menu.ids.length}건)`}
            onSelect={() => void onResumeSelected(menu.ids)}
          />
          <MenuItem
            disabled={!allowMutations || !canPause || mutationPending}
            label={`중지 (${menu.ids.length}건)`}
            onSelect={() => void onPauseSelected(menu.ids)}
          />
          {allowMutations && menu.ids.length === 1 && selectedRows[0]?.source === 'CUSTOM' ? (
            <MenuItem
              disabled={mutationPending}
              label="수정"
              onSelect={() => {
                const target = orders.find((order) => order.id === menu.ids[0]);
                if (target) onEditRow(target);
                closeMenu();
              }}
            />
          ) : null}
          <MenuItem
            disabled={!allowMutations || mutationPending}
            label={`삭제 (${menu.ids.length}건)`}
            onSelect={() => void onDeleteSelected(menu.ids)}
          />
        </div>
      ) : null}
    </div>
  );
};

interface MenuItemProps {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const MenuItem = ({ disabled = false, label, onSelect }: MenuItemProps): ReactElement => (
  <button
    type="button"
    disabled={disabled}
    onClick={onSelect}
    style={{
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '0.35rem 0.8rem',
      background: 'transparent',
      border: 'none',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--hts-muted, rgba(0,0,0,0.4))' : 'inherit',
      fontSize: 'inherit',
    }}
  >
    {label}
  </button>
);

function statusLabel(status: WatchOrder['status']): string {
  switch (status) {
    case 'WATCHING':
      return '감시중';
    case 'PAUSED':
      return '일시중지';
    case 'EXECUTED':
      return '실행';
    case 'FAILED':
      return '실패';
    case 'EXPIRED':
      return '만료';
    case 'CANCELLED':
      return '삭제';
  }
}

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', { hour12: false });
}
