import type { WatchOrder } from '@renderer/entities/watch-order';
import type { WatchOrderFormPrefill } from '@renderer/features/add-watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, DialogType, dialog } from '@renderer/shared/ui';
import { type ReactElement, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useWatchOrderActions } from '../model/use-watch-order-actions';
import { WatchContextMenu, type WatchContextMenuState } from './watch-context-menu';
import { WatchTable } from './watch-table';

export interface WatchListProps {
  orders: WatchOrder[];
  isPending: boolean;
  error: { message: string } | null;
  allowMutations: boolean;
  emptyMessage?: string;
  onEditOrder?: (prefill: WatchOrderFormPrefill) => void;
  summaryLabel?: string;
}

interface WatchActionState {
  canDelete: boolean;
  canEdit: boolean;
  canPause: boolean;
  canResume: boolean;
  helpText: string;
}

export const WatchList = (props: WatchListProps): ReactElement => {
  const { allowMutations, emptyMessage, error, isPending, onEditOrder, orders, summaryLabel } =
    props;
  const actions = useWatchOrderActions();
  const stockMaster = trpc.market.listAllStock.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<WatchContextMenuState | null>(null);

  const stockNameByPdno = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of stockMaster.data?.entries ?? []) {
      map.set(entry.pdno, entry.name);
    }
    return map;
  }, [stockMaster.data?.entries]);

  useEffect(() => {
    setSelected((prev) => {
      if (!allowMutations) return prev.size === 0 ? prev : new Set();
      if (prev.size === 0) return prev;
      const liveIds = new Set(orders.map((order) => order.id));
      const next = new Set(Array.from(prev).filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (!allowMutations) setMenu(null);
  }, [allowMutations, orders]);

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const targetIdsForRow = useEffectEvent((fallbackId: number): number[] => {
    if (selected.has(fallbackId) && selected.size > 0) return Array.from(selected);
    return [fallbackId];
  });

  const onContextMenu = useEffectEvent((event: React.MouseEvent, fallbackId: number) => {
    if (!allowMutations) return;
    event.preventDefault();
    const ids = targetIdsForRow(fallbackId);
    const rows = orders.filter((order) => ids.includes(order.id));
    setMenu({
      ids,
      targetLabel: formatWatchMenuTarget(rows, stockNameByPdno),
      x: event.clientX,
      y: event.clientY,
    });
  });

  const selectedRows = useMemo(
    () => (menu ? orders.filter((order) => menu.ids.includes(order.id)) : []),
    [menu, orders],
  );
  const selectedOrderRows = useMemo(
    () => orders.filter((order) => selected.has(order.id)),
    [orders, selected],
  );
  const menuAction = buildWatchActionState(selectedRows, allowMutations);
  const selectedAction = buildWatchActionState(selectedOrderRows, allowMutations);

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
    <div className="watch-table-shell">
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <div
        className="watch-table-toolbar"
        role="toolbar"
        aria-label={allowMutations ? '선택한 자동감시 작업' : '자동감시 탭 요약'}
      >
        {allowMutations ? (
          <>
            <span className="watch-table-toolbar__count">{selected.size}건 선택</span>
            <Button
              dense
              disabled={actions.mutationPending || !selectedAction.canResume}
              title={selectedAction.canResume ? '선택한 자동감시 시작' : selectedAction.helpText}
              onClick={() => clearAndRun(actions.resumeSelected, Array.from(selected))}
            >
              시작
            </Button>
            <Button
              dense
              disabled={actions.mutationPending || !selectedAction.canPause}
              title={selectedAction.canPause ? '선택한 자동감시 중지' : selectedAction.helpText}
              onClick={() => clearAndRun(actions.pauseSelected, Array.from(selected))}
            >
              중지
            </Button>
            <Button
              dense
              variant="danger"
              disabled={actions.mutationPending || !selectedAction.canDelete}
              title={selectedAction.canDelete ? '선택한 자동감시 삭제' : selectedAction.helpText}
              onClick={() => {
                void confirmAndDelete(Array.from(selected));
              }}
            >
              삭제
            </Button>
            <span className="muted watch-table-toolbar__hint">{selectedAction.helpText}</span>
          </>
        ) : (
          <>
            <span className="watch-table-toolbar__count">{summaryLabel ?? '조회 결과'}</span>
            <span className="muted watch-table-toolbar__hint">{orders.length}건</span>
          </>
        )}
      </div>
      <WatchTable
        allowMutations={allowMutations}
        isPending={isPending}
        {...(emptyMessage ? { emptyMessage } : {})}
        onContextMenu={onContextMenu}
        onToggle={toggle}
        orders={orders}
        selected={selected}
        stockNameByPdno={stockNameByPdno}
      />
      {menu ? (
        <WatchContextMenu
          allowEdit={menuAction.canEdit}
          allowMutations={allowMutations}
          canDelete={menuAction.canDelete}
          canPause={menuAction.canPause}
          canResume={menuAction.canResume}
          helpText={menuAction.helpText}
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

function buildWatchActionState(rows: WatchOrder[], allowMutations: boolean): WatchActionState {
  const hasRows = rows.length > 0;
  const allWatching = hasRows && rows.every((order) => order.status === 'WATCHING');
  const allPaused = hasRows && rows.every((order) => order.status === 'PAUSED');
  const canPause = allowMutations && allWatching;
  const canResume = allowMutations && allPaused;
  const canDelete = allowMutations && hasRows;
  const canEdit = allowMutations && rows.length === 1 && rows[0]?.source === 'CUSTOM';

  let helpText = '작업할 자동감시를 선택하세요.';
  if (hasRows && allWatching) helpText = '선택한 항목은 중지할 수 있습니다.';
  else if (hasRows && allPaused) helpText = '선택한 항목은 시작할 수 있습니다.';
  else if (hasRows) helpText = '상태가 섞인 항목은 시작/중지를 한 번에 실행할 수 없습니다.';

  return {
    canDelete,
    canEdit,
    canPause,
    canResume,
    helpText,
  };
}

function formatWatchStockLabel(order: WatchOrder, stockNameByPdno: Map<string, string>): string {
  const name = stockNameByPdno.get(order.pdno);
  return name ? `${name} (${order.pdno})` : order.pdno;
}

function formatWatchMenuTarget(rows: WatchOrder[], stockNameByPdno: Map<string, string>): string {
  if (rows.length === 0) return '자동감시';
  const first = rows[0];
  if (!first) return '자동감시';
  const firstLabel = formatWatchStockLabel(first, stockNameByPdno);
  return rows.length === 1 ? firstLabel : `${firstLabel} 외 ${rows.length - 1}건`;
}

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
