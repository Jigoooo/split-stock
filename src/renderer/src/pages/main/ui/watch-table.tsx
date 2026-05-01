import type { WatchOrder } from '@renderer/entities/watch-order';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { WatchListRow } from './watch-list-row';
import { WATCH_TABLE_COLS } from './watch-table-columns';

interface WatchTableProps {
  allSelected: boolean;
  allowMutations: boolean;
  emptyMessage?: string;
  isPending: boolean;
  onContextMenu: (event: React.MouseEvent, fallbackId: number) => void;
  onToggleAll: () => void;
  onToggle: (id: number) => void;
  orders: WatchOrder[];
  selected: Set<number>;
  someSelected: boolean;
  stockNameByPdno: Map<string, string>;
}

export const WatchTable = ({
  allSelected,
  allowMutations,
  emptyMessage = '자동감시 종목이 없습니다. 상단 "+ 추가" 버튼으로 시작하세요.',
  isPending,
  onContextMenu,
  onToggleAll,
  onToggle,
  orders,
  selected,
  someSelected,
  stockNameByPdno,
}: WatchTableProps): ReactElement => (
  <TableGrid.Root
    variant="hts"
    stickyHeader
    horizontalScroll
    aria-label="자동감시 리스트"
    className="watch-orders-table"
    style={{ flex: 1, minHeight: 0 }}
  >
    <TableGrid.Header>
      {allowMutations ? (
        <TableGrid.Cell width={WATCH_TABLE_COLS.select} resizable={false}>
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={onToggleAll}
            aria-label="자동감시 전체 선택"
            disabled={isPending || orders.length === 0}
            dense
          />
        </TableGrid.Cell>
      ) : null}
      <TableGrid.Cell width={WATCH_TABLE_COLS.stock}>종목</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.source}>구분</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.targetPrice} numeric>
        목표가
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.orderBasis} numeric>
        주문 기준
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.orderType}>주문</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.status}>상태</TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.createdAt} className="muted date-time-cell">
        등록
      </TableGrid.Cell>
      <TableGrid.Cell width={WATCH_TABLE_COLS.failureReason} className="muted">
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
          <TableGrid.Cell className="muted">{emptyMessage}</TableGrid.Cell>
        </TableGrid.Row>
      ) : (
        orders.map((order) => (
          <WatchListRow
            key={order.id}
            allowMutations={allowMutations}
            onContextMenu={onContextMenu}
            onToggle={onToggle}
            order={order}
            selected={selected.has(order.id)}
            stockName={stockNameByPdno.get(order.pdno) ?? null}
          />
        ))
      )}
    </TableGrid.Body>
  </TableGrid.Root>
);
