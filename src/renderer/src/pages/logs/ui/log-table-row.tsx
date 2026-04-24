import { TableGrid } from '@renderer/shared/ui';
import { memo, type ReactElement } from 'react';
import { LOG_TABLE_COLUMN_WIDTHS, levelClass } from '../config/log-table';
import type { LogPayloadPreview } from '../lib/log-payload';
import type { LogEntry } from '../model/use-log-tail';
import { PayloadSummary } from './payload-summary';

interface LogTableRowProps {
  category: string;
  index: number;
  isSelected: boolean;
  level: string;
  message: string;
  measureElement: (el: Element | null) => void;
  onSelect: (id: LogEntry['id']) => void;
  payload: LogPayloadPreview;
  rowId: LogEntry['id'];
  timestampLabel: string;
  top: number;
}

export const LogTableRow = memo(function LogTableRow(props: LogTableRowProps): ReactElement {
  const {
    category,
    index,
    isSelected,
    level,
    message,
    measureElement,
    onSelect,
    payload,
    rowId,
    timestampLabel,
    top,
  } = props;

  return (
    <TableGrid.Row
      ref={measureElement}
      data-index={index}
      data-key={String(rowId)}
      onClick={() => onSelect(rowId)}
      selected={isSelected}
      style={{ left: 0, position: 'absolute', right: 0, top }}
    >
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.timestamp} numeric>
        {timestampLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>
        <span className={levelClass(level)}>{level}</span>
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>{category}</TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.message} overflow="ellipsis" title={message}>
        {message}
      </TableGrid.Cell>
      <TableGrid.Cell
        width={LOG_TABLE_COLUMN_WIDTHS.payload}
        overflow="ellipsis"
        {...(payload.summary === '-' ? {} : { title: payload.summary })}
      >
        <PayloadSummary payload={payload} />
      </TableGrid.Cell>
    </TableGrid.Row>
  );
});
