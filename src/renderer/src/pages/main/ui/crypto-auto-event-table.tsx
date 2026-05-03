import { TableGrid } from '@renderer/shared/ui';
import type { CryptoAutoEvent } from '@shared/contracts';
import type { ReactElement } from 'react';
import { formatDateTime } from '../model/crypto-formatters';

export const CryptoAutoEventTable = ({
  emptyText,
  events,
}: {
  emptyText: string;
  events: CryptoAutoEvent[];
}): ReactElement => (
  <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동감시 실행내역">
    <TableGrid.Header>
      <TableGrid.Cell width="10rem">마켓</TableGrid.Cell>
      <TableGrid.Cell width="10rem">구분</TableGrid.Cell>
      <TableGrid.Cell width="10rem">액션</TableGrid.Cell>
      <TableGrid.Cell width="24rem">사유</TableGrid.Cell>
      <TableGrid.Cell width="12rem">시각</TableGrid.Cell>
    </TableGrid.Header>
    <TableGrid.Body>
      {events.map((event) => (
        <TableGrid.Row key={event.id}>
          <TableGrid.Cell width="10rem" className="num">
            {event.market}
          </TableGrid.Cell>
          <TableGrid.Cell width="10rem">{event.kind}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{event.action}</TableGrid.Cell>
          <TableGrid.Cell width="24rem">{event.reason}</TableGrid.Cell>
          <TableGrid.Cell width="12rem">{formatDateTime(event.createdAt)}</TableGrid.Cell>
        </TableGrid.Row>
      ))}
      {events.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell width="100%" className="muted">
            {emptyText}
          </TableGrid.Cell>
        </TableGrid.Row>
      ) : null}
    </TableGrid.Body>
  </TableGrid.Root>
);
