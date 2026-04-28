import { Children, cloneElement, Fragment, isValidElement, type ReactElement } from 'react';
import type { HeaderProps } from '../model/types';
import { TableGridCell } from './table-grid-cell';
import { useTableGridContext } from './table-grid-root';

/**
 * TableGrid.Header — flex row 헤더.
 * - sticky top:0 (Root.stickyHeader=true 시)
 * - 자식은 TableGrid.Cell 권장 (data-cell-role="header" attr 부여를 위해 직접 컴포넌트 분기)
 * - storageKey 설정 시 수동 너비가 존재하면 초기화 아이콘 자동 표시
 */
export function TableGridHeader(props: HeaderProps): ReactElement {
  const { className, style, children } = props;
  const { stickyHeader, hasStorageKey, manualColumnWidths, resetColumnWidths } =
    useTableGridContext();
  const hasManualWidths = Object.keys(manualColumnWidths).length > 0;
  const indexedChildren = Children.map(children, (child, columnIndex) => {
    if (!isValidElement(child) || child.type === Fragment || child.type !== TableGridCell) {
      return child;
    }

    return cloneElement(child as ReactElement<{ columnIndex?: number; isHeader?: boolean }>, {
      columnIndex,
      isHeader: true,
    });
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
      {hasStorageKey && hasManualWidths ? (
        <button
          type="button"
          title="컬럼 너비 초기화"
          onClick={resetColumnWidths}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.4rem',
            height: '100%',
            padding: 0,
            color: 'var(--text-secondary, #888)',
            flexShrink: 0,
            opacity: 0.6,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6';
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>컬럼 너비 초기화</title>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
