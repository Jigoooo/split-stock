import type { WatchOrder } from '@renderer/entities/watch-order';
import type { WatchOrderFormPrefill } from '@renderer/features/add-watch-order';
import { Button, DialogType, dialog } from '@renderer/shared/ui';
import { type ReactElement, useEffectEvent, useMemo, useState } from 'react';
import { useWatchOrderActions } from '../model/use-watch-order-actions';
import { WatchContextMenu, type WatchContextMenuState } from './watch-context-menu';
import { WatchTable } from './watch-table';

export interface WatchListProps {
  orders: WatchOrder[];
  isPending: boolean;
  error: { message: string } | null;
  allowMutations: boolean;
  onEditOrder?: (prefill: WatchOrderFormPrefill) => void;
}

export const WatchList = (props: WatchListProps): ReactElement => {
  const { allowMutations, error, isPending, onEditOrder, orders } = props;
  const actions = useWatchOrderActions();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<WatchContextMenuState | null>(null);

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onContextMenu = useEffectEvent((event: React.MouseEvent, fallbackId: number) => {
    event.preventDefault();
    const ids = selected.size > 0 ? Array.from(selected) : [fallbackId];
    setMenu({ ids, x: event.clientX, y: event.clientY });
  });

  const selectedRows = useMemo(
    () => (menu ? orders.filter((order) => menu.ids.includes(order.id)) : []),
    [menu, orders],
  );
  const selectedOrderRows = useMemo(
    () => orders.filter((order) => selected.has(order.id)),
    [orders, selected],
  );
  const canPause =
    selectedRows.length > 0 && selectedRows.every((order) => order.status === 'WATCHING');
  const canResume =
    selectedRows.length > 0 && selectedRows.every((order) => order.status === 'PAUSED');
  const allowEdit =
    allowMutations && menu?.ids.length === 1 && selectedRows[0]?.source === 'CUSTOM';

  const closeMenu = (): void => setMenu(null);
  const clearAndRun = (run: (ids: number[]) => Promise<void>, ids: number[]): void => {
    closeMenu();
    setSelected(new Set());
    void run(ids);
  };
  const confirmAndDelete = async (ids: number[]): Promise<void> => {
    const rows = orders.filter((order) => ids.includes(order.id));
    const confirmed = await dialog.openAsync({
      type: DialogType.WARNING,
      title: '자동감시 삭제',
      confirmText: '삭제',
      cancelText: '취소',
      isCancelWith: true,
      message: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div>
            선택한 자동감시 <strong>{ids.length}건</strong>을 삭제합니다.
          </div>
          {rows.length > 0 ? (
            <div className="muted">
              {rows
                .slice(0, 3)
                .map((order) => `${order.pdno} ${order.orderType}`)
                .join(', ')}
              {rows.length > 3 ? ` 외 ${rows.length - 3}건` : ''}
            </div>
          ) : null}
          <div className="muted">삭제 후 해당 조건으로는 더 이상 자동감시가 실행되지 않습니다.</div>
        </div>
      ),
    });
    if (!confirmed) return;
    clearAndRun(actions.deleteSelected, ids);
  };

  const editSelected = (): void => {
    const target = orders.find((order) => order.id === menu?.ids[0]);
    if (!target) return;
    onEditOrder?.(toWatchOrderFormPrefill(target));
    closeMenu();
  };

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
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      {allowMutations && selected.size > 0 ? (
        <div
          role="toolbar"
          aria-label="선택한 자동감시 작업"
          style={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            padding: '0.5rem',
            borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.12))',
          }}
        >
          <span className="muted">{selected.size}건 선택</span>
          <Button
            dense
            disabled={
              actions.mutationPending ||
              selectedOrderRows.length === 0 ||
              !selectedOrderRows.every((order) => order.status === 'PAUSED')
            }
            onClick={() => clearAndRun(actions.resumeSelected, Array.from(selected))}
          >
            시작
          </Button>
          <Button
            dense
            disabled={
              actions.mutationPending ||
              selectedOrderRows.length === 0 ||
              !selectedOrderRows.every((order) => order.status === 'WATCHING')
            }
            onClick={() => clearAndRun(actions.pauseSelected, Array.from(selected))}
          >
            중지
          </Button>
          <Button
            dense
            variant="danger"
            disabled={actions.mutationPending}
            onClick={() => {
              void confirmAndDelete(Array.from(selected));
            }}
          >
            삭제
          </Button>
        </div>
      ) : null}
      <WatchTable
        allowMutations={allowMutations}
        isPending={isPending}
        onContextMenu={onContextMenu}
        onToggle={toggle}
        orders={orders}
        selected={selected}
      />
      {menu ? (
        <WatchContextMenu
          allowEdit={allowEdit}
          allowMutations={allowMutations}
          canPause={canPause}
          canResume={canResume}
          menu={menu}
          mutationPending={actions.mutationPending}
          onClose={closeMenu}
          onDelete={(ids) => {
            void confirmAndDelete(ids);
          }}
          onEdit={editSelected}
          onPause={(ids) => clearAndRun(actions.pauseSelected, ids)}
          onResume={(ids) => clearAndRun(actions.resumeSelected, ids)}
        />
      ) : null}
    </div>
  );
};

function toWatchOrderFormPrefill(order: WatchOrder): WatchOrderFormPrefill {
  return {
    existingId: order.id,
    pdno: order.pdno,
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
  };
}
