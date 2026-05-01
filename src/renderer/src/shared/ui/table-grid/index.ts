// 스타일 자동 주입 — Compound import 시 함께 로드
import './styles/index.css';

import { TableGridBody } from './ui/table-grid-body';
import { TableGridCell } from './ui/table-grid-cell';
import { TableGridHeader } from './ui/table-grid-header';
import { TableGridRoot } from './ui/table-grid-root';
import { TableGridRow } from './ui/table-grid-row';

export type {
  Align,
  BodyProps,
  CellProps,
  FlashDirection,
  HeaderProps,
  OverflowMode,
  RootProps,
  RowProps,
  Variant,
} from './model/types';

export type {
  UseTableGridVirtualOptions,
  UseTableGridVirtualResult,
} from './model/use-table-grid-virtual';
export { useTableGridVirtual } from './model/use-table-grid-virtual';

/**
 * TableGrid — Compound 컴포넌트.
 *
 * 사용 예시:
 * ```tsx
 * <TableGrid.Root variant="hts" stickyHeader zebra>
 *   <TableGrid.Header>
 *     <TableGrid.Cell width="12rem">종목명</TableGrid.Cell>
 *     <TableGrid.Cell flex={1} numeric>현재가</TableGrid.Cell>
 *   </TableGrid.Header>
 *   <TableGrid.Body>
 *     {rows.map((r) => (
 *       <TableGrid.Row key={r.id} selected={r.id === selectedId} onClick={...}>
 *         <TableGrid.Cell width="12rem">{r.name}</TableGrid.Cell>
 *         <TableGrid.Cell flex={1} numeric>{r.price}</TableGrid.Cell>
 *       </TableGrid.Row>
 *     ))}
 *   </TableGrid.Body>
 * </TableGrid.Root>
 * ```
 */
export const TableGrid = {
  Root: TableGridRoot,
  Header: TableGridHeader,
  Body: TableGridBody,
  Row: TableGridRow,
  Cell: TableGridCell,
} as const;
