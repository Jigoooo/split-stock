import { Children, cloneElement, Fragment, isValidElement, type ReactElement } from 'react';
import type { HeaderProps } from '../model/types';
import { TableGridCell } from './table-grid-cell';
import { useTableGridContext } from './table-grid-root';

/**
 * TableGrid.Header — flex row 헤더.
 * - sticky top:0 (Root.stickyHeader=true 시)
 * - 자식은 TableGrid.Cell 권장 (data-cell-role="header" attr 부여를 위해 직접 컴포넌트 분기)
 */
export function TableGridHeader(props: HeaderProps): ReactElement {
  const { className, style, children } = props;
  const { stickyHeader } = useTableGridContext();
  const indexedChildren = Children.map(children, (child, columnIndex) => {
    if (!isValidElement(child) || child.type === Fragment || child.type !== TableGridCell) {
      return child;
    }

    return cloneElement(child as ReactElement<{ columnIndex?: number }>, { columnIndex });
  });

  return (
    <div
      data-grid-role="header"
      className={['table-grid-header', className ?? ''].filter(Boolean).join(' ')}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexShrink: 0,
        position: stickyHeader ? 'sticky' : 'relative',
        top: stickyHeader ? 0 : undefined,
        zIndex: stickyHeader ? 2 : undefined,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {indexedChildren}
    </div>
  );
}
