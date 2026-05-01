import type { WatchOrder } from '@renderer/entities/watch-order';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { WatchListRow } from './watch-list-row';

interface WatchTableProps {
  allowMutations: boolean;
  emptyMessage?: string;
  isPending: boolean;
  onContextMenu: (event: React.MouseEvent, fallbackId: number) => void;
  onToggle: (id: number) => void;
  orders: WatchOrder[];
  selected: Set<number>;
  stockNameByPdno: Map<string, string>;
}

export const WatchTable = ({
  allowMutations,
  emptyMessage = '자동감시 종목이 없습니다. 상단 "+ 추가" 버튼으로 시작하세요.',
  isPending,
  onContextMenu,
  onToggle,
  orders,
  selected,
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
      {allowMutations ? <TableGrid.Cell width="4.2rem" /> : null}
      <TableGrid.Cell width="16.8rem">종목</TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">구분</TableGrid.Cell>
      <TableGrid.Cell width="9rem" numeric>
        목표가
      </TableGrid.Cell>
      <TableGrid.Cell width="9rem" numeric>
        주문 기준
      </TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">주문</TableGrid.Cell>
      <TableGrid.Cell width="7.2rem">상태</TableGrid.Cell>
      <TableGrid.Cell width="17.6rem" className="muted date-time-cell">
        등록
      </TableGrid.Cell>
      <TableGrid.Cell width="12rem" className="muted">
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
