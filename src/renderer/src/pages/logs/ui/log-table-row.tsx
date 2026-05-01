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
  repeatCount?: number;
  rowId: LogEntry['id'];
  timestampLabel: string;
  timestampTitle?: string;
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
    repeatCount = 1,
    rowId,
    timestampLabel,
    timestampTitle = timestampLabel,
    top,
  } = props;
  const contentTitle = [
    payload.summary === '-' ? message : `${message} · ${payload.summary}`,
    repeatCount > 1 ? `x${repeatCount}` : '',
    timestampTitle,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TableGrid.Row
      ref={measureElement}
      data-index={index}
      data-key={String(rowId)}
      onClick={() => onSelect(rowId)}
      selected={isSelected}
      style={{ left: 0, position: 'absolute', right: 0, top }}
    >
      <TableGrid.Cell
        width={LOG_TABLE_COLUMN_WIDTHS.timestamp}
        numeric
        className="logs-table-row__timestamp"
        title={timestampTitle}
      >
        {timestampLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>
        <span className={levelClass(level)}>{level}</span>
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>{category}</TableGrid.Cell>
      <TableGrid.Cell
        width={LOG_TABLE_COLUMN_WIDTHS.content}
        overflow="nowrap"
        title={contentTitle}
      >
        <div className="logs-table-row__content">
          <span className="logs-table-row__message">
            {message}
            {repeatCount > 1 ? <span className="logs-repeat-badge">x{repeatCount}</span> : null}
          </span>
          <PayloadSummary payload={payload} />
        </div>
      </TableGrid.Cell>
    </TableGrid.Row>
  );
});
