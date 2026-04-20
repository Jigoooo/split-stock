import type { CSSProperties, ReactElement } from 'react';
import type { CellProps, OverflowMode } from '../model/types';

const overflowStyle = (mode: OverflowMode): CSSProperties => {
  switch (mode) {
    case 'nowrap':
      return { whiteSpace: 'nowrap', overflow: 'hidden' };
    case 'ellipsis':
      return { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
    case 'wrap':
      return { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere' };
    case 'scroll':
      return { whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden' };
  }
};

const overflowClass = (mode: OverflowMode): string => `table-grid-cell--ovf-${mode}`;

/**
 * TableGrid.Cell — flex item.
 * - width 고정 (number→px) 또는 flex grow.
 * - align/overflow/numeric 옵션.
 * - numeric=true → align right + mono + tabular-nums.
 * - sticky="right" → 가로 스크롤 시 우측 고정 (액션 컬럼 등)
 *
 * 셀 내부 인터랙션이 필요하면 children 에 <button> 등 시맨틱 요소를 직접 배치.
 */
export function TableGridCell(props: CellProps): ReactElement {
  const {
    width,
    flex,
    minWidth,
    maxWidth,
    align,
    overflow = 'nowrap',
    numeric = false,
    sticky,
    className,
    style,
    title,
    children,
  } = props;

  const flexBasis: CSSProperties =
    width !== undefined
      ? { width, flex: '0 0 auto' }
      : flex !== undefined
        ? { flex: `${flex} ${flex} 0%`, minWidth: 0 }
        : { flex: '1 1 0%', minWidth: 0 };

  const finalAlign = align ?? (numeric ? 'right' : undefined);

  const stickyStyle: CSSProperties = sticky
    ? {
        position: 'sticky',
        [sticky]: 0,
        zIndex: 1,
        // 좌/우 구분선
        ...(sticky === 'right'
          ? { borderLeft: '1px solid var(--border-strong, rgba(0,0,0,0.15))' }
          : {}),
        ...(sticky === 'left'
          ? { borderRight: '1px solid var(--border-strong, rgba(0,0,0,0.15))' }
          : {}),
      }
    : {};

  return (
    <div
      data-grid-role="cell"
      data-numeric={numeric || undefined}
      data-overflow={overflow}
      data-sticky={sticky || undefined}
      title={title}
      className={[
        'table-grid-cell',
        numeric ? 'table-grid-cell--num' : '',
        sticky ? `table-grid-cell--sticky-${sticky}` : '',
        overflowClass(overflow),
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        boxSizing: 'border-box',
        ...flexBasis,
        ...(minWidth !== undefined ? { minWidth } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
        ...(finalAlign ? { textAlign: finalAlign } : {}),
        ...overflowStyle(overflow),
        ...stickyStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
