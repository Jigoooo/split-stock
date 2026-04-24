import { TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useRef } from 'react';
import { formatLogTs, LOG_TABLE_COLUMN_WIDTHS, LOG_TABLE_TOTAL_WIDTH } from '../config/log-table';
import { buildLogPayloadPreview } from '../lib/log-payload';
import type { LogEntry } from '../model/use-log-tail';
import { LogTableRow } from './log-table-row';

interface LogsTableProps {
  entries: LogEntry[];
  error: { message: string } | null;
  isPending: boolean;
  isTransitionPending: boolean;
  onSelect: (id: LogEntry['id']) => void;
  selectedId: LogEntry['id'] | null;
}

export const LogsTable = ({
  entries,
  error,
  isPending,
  isTransitionPending,
  onSelect,
  selectedId,
}: LogsTableProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: entries.length,
    estimateSize: () => 26,
    parentRef: scrollRef,
    overscan: 12,
  });

  return (
    <TableGrid.Root
      variant="hts"
      stickyHeader
      horizontalScroll
      aria-label="이벤트 로그"
      style={{ flex: 1, minHeight: 0 }}
    >
      <TableGrid.Header>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.timestamp} numeric>
          시각
        </TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>레벨</TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>카테고리</TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.message} overflow="ellipsis">
          메시지
        </TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.payload} overflow="ellipsis">
          payload 요약
        </TableGrid.Cell>
      </TableGrid.Header>
      <TableGrid.Body scrollRef={scrollRef}>
        {error ? (
          <TableGrid.Row>
            <TableGrid.Cell width={LOG_TABLE_TOTAL_WIDTH}>
              <span className="chip chip--down">{error.message}</span>
            </TableGrid.Cell>
          </TableGrid.Row>
        ) : null}
        {isPending || isTransitionPending ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
          </TableGrid.Row>
        ) : null}
        {!isPending && !isTransitionPending && !error && entries.length === 0 ? (
          <TableGrid.Row placeholder>
            <TableGrid.Cell className="muted">기록된 로그가 없습니다.</TableGrid.Cell>
          </TableGrid.Row>
        ) : null}
        {entries.length > 0 ? (
          <div
            style={{
              height: virtual.totalSize,
              minWidth: '100%',
              position: 'relative',
              width: LOG_TABLE_TOTAL_WIDTH,
            }}
          >
            {virtual.items.map((vItem) => {
              const entry = entries[vItem.index];
              if (!entry) return null;

              return (
                <LogTableRow
                  key={entry.id}
                  category={entry.category}
                  index={vItem.index}
                  isSelected={selectedId === entry.id}
                  level={entry.level}
                  message={entry.message}
                  measureElement={virtual.measureElement}
                  onSelect={onSelect}
                  payload={buildLogPayloadPreview(entry.payloadJson)}
                  rowId={entry.id}
                  timestampLabel={formatLogTs(entry.ts)}
                  top={vItem.start}
                />
              );
            })}
          </div>
        ) : null}
      </TableGrid.Body>
    </TableGrid.Root>
  );
};
