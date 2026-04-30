import { TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useCallback, useRef } from 'react';
import {
  formatLogTs,
  LOG_TABLE_COLUMN_WIDTHS,
  LOG_TABLE_ROW_ESTIMATE,
  LOG_TABLE_TOTAL_WIDTH,
} from '../config/log-table';
import { buildLogPayloadPreview } from '../lib/log-payload';
import type { LogEntry } from '../model/use-log-tail';
import { LogTableRow } from './log-table-row';

const LOG_TABLE_SKELETON_ROWS = [
  'skeleton-1',
  'skeleton-2',
  'skeleton-3',
  'skeleton-4',
  'skeleton-5',
  'skeleton-6',
  'skeleton-7',
  'skeleton-8',
] as const;

interface LogsTableProps {
  entries: LogEntry[];
  error: { message: string } | null;
  isFilterSettling: boolean;
  isPending: boolean;
  onSelect: (id: LogEntry['id']) => void;
  selectedId: LogEntry['id'] | null;
}

export const LogsTable = ({
  entries,
  error,
  isFilterSettling,
  isPending,
  onSelect,
  selectedId,
}: LogsTableProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((index: number) => entries[index]?.id ?? index, [entries]);
  const virtual = useTableGridVirtual({
    count: entries.length,
    estimateSize: () => LOG_TABLE_ROW_ESTIMATE,
    getItemKey,
    parentRef: scrollRef,
    overscan: 12,
    useFlushSync: false,
  });
  const showInitialSkeleton = isPending && entries.length === 0;
  const showUpdatingStrip =
    !showInitialSkeleton && !error && entries.length > 0 && isFilterSettling;

  return (
    <TableGrid.Root
      variant="hts"
      stickyHeader
      horizontalScroll
      aria-label="이벤트 로그"
      className="logs-table"
      style={{ flex: 1, minHeight: 0 }}
    >
      <TableGrid.Header>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.timestamp} numeric>
          시각
        </TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>레벨</TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>분류</TableGrid.Cell>
        <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.content} overflow="ellipsis">
          내용
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
        {showInitialSkeleton ? <LogsTableSkeleton /> : null}
        {showUpdatingStrip ? (
          <div className="logs-table__update-strip" role="status" aria-live="polite">
            필터 반영 중...
          </div>
        ) : null}
        {!isPending && !error && entries.length === 0 ? (
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
                  key={vItem.key}
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

function LogsTableSkeleton(): ReactElement {
  return (
    <div
      className="logs-table__skeleton"
      aria-hidden
      style={{ minWidth: '100%', width: LOG_TABLE_TOTAL_WIDTH }}
    >
      {LOG_TABLE_SKELETON_ROWS.map((rowKey) => (
        <div className="logs-table__skeleton-row" key={rowKey}>
          <span style={{ width: LOG_TABLE_COLUMN_WIDTHS.timestamp - 24 }} />
          <span style={{ width: LOG_TABLE_COLUMN_WIDTHS.level - 24 }} />
          <span style={{ width: LOG_TABLE_COLUMN_WIDTHS.category - 24 }} />
          <span style={{ flex: 1 }} />
        </div>
      ))}
    </div>
  );
}
