import type { WatchOrder } from '@renderer/entities/watch-order';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { WatchListRow } from './watch-list-row';

interface WatchTableProps {
  allowMutations: boolean;
  isPending: boolean;
  onContextMenu: (event: React.MouseEvent, fallbackId: number) => void;
  onToggle: (id: number) => void;
  orders: WatchOrder[];
  selected: Set<number>;
}

export const WatchTable = ({
  allowMutations,
  isPending,
  onContextMenu,
  onToggle,
  orders,
  selected,
}: WatchTableProps): ReactElement => (
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
      <TableGrid.Cell width={90} numeric>
        목표가
      </TableGrid.Cell>
      <TableGrid.Cell width={90} numeric>
        수량
      </TableGrid.Cell>
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
          <WatchListRow
            key={order.id}
            allowMutations={allowMutations}
            onContextMenu={onContextMenu}
            onToggle={onToggle}
            order={order}
            selected={selected.has(order.id)}
          />
        ))
      )}
    </TableGrid.Body>
  </TableGrid.Root>
);
