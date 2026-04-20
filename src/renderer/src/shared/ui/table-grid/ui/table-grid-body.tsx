import { type ReactElement, type Ref, useCallback } from 'react';
import type { BodyProps } from '../model/types';
import { useTableGridContext } from './table-grid-root';

export interface TableGridBodyProps extends BodyProps {
  /** 외부에서 scroll container 직접 접근 — useTableGridVirtual 의 parentRef 로 전달 */
  scrollRef?: Ref<HTMLDivElement>;
}

/**
 * TableGrid.Body — flex column scroll container.
 * - flex: 1, overflow-y: auto, min-height: 0
 * - Root.bodyRef 에 자동 등록 (OverlayScrollbar 부착)
 * - scrollRef prop 으로 가상화 hook 의 parentRef 와 동기화 가능
 */
export function TableGridBody(props: TableGridBodyProps): ReactElement {
  const { scrollRef, className, style, children } = props;
  const { bodyRef } = useTableGridContext();

  // Root context bodyRef + 외부 scrollRef 동시에 부착
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      bodyRef.current = el;
      if (typeof scrollRef === 'function') {
        scrollRef(el);
      } else if (scrollRef && 'current' in scrollRef) {
        (scrollRef as { current: HTMLDivElement | null }).current = el;
      }
    },
    [bodyRef, scrollRef],
  );

  return (
    <div
      ref={setRef}
      data-grid-role="body"
      className={['table-grid-body', className ?? ''].filter(Boolean).join(' ')}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
