import { createContext, type ReactElement, useContext, useMemo, useRef } from 'react';
import { OverlayScrollbar } from '../../overlay-scrollbar';
import type { RootProps, Variant } from '../model/types';

interface TableGridContextValue {
  variant: Variant;
  stickyHeader: boolean;
  zebra: boolean;
  overlayScrollbar: boolean;
  /** Body 가 등록한 scroll container ref — Root 가 OverlayScrollbar 에 전달 */
  bodyRef: React.RefObject<HTMLDivElement | null>;
}

const TableGridContext = createContext<TableGridContextValue | null>(null);

export function useTableGridContext(): TableGridContextValue {
  const ctx = useContext(TableGridContext);
  if (!ctx) {
    throw new Error('TableGrid sub-component must be used within <TableGrid.Root>');
  }
  return ctx;
}

/**
 * TableGrid.Root — Compound 진입점.
 * - flex column 컨테이너 (height: 100%, min-height: 0, overflow: hidden)
 * - data-variant attr 로 hts/plain 스타일 분기
 * - OverlayScrollbar 자동 마운트 (Body 의 scroll container 에 부착)
 */
export function TableGridRoot(props: RootProps): ReactElement {
  const {
    variant = 'plain',
    stickyHeader = true,
    zebra = true,
    overlayScrollbar = true,
    'aria-label': ariaLabel,
    className,
    style,
    children,
  } = props;

  const bodyRef = useRef<HTMLDivElement | null>(null);

  const ctx = useMemo<TableGridContextValue>(
    () => ({ variant, stickyHeader, zebra, overlayScrollbar, bodyRef }),
    [variant, stickyHeader, zebra, overlayScrollbar],
  );

  return (
    <TableGridContext.Provider value={ctx}>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role=region supports aria-label */}
      <div
        data-variant={variant}
        data-sticky-header={stickyHeader}
        data-zebra={zebra}
        role={ariaLabel ? 'region' : undefined}
        aria-label={ariaLabel}
        className={['table-grid-root', className ?? ''].filter(Boolean).join(' ')}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          ...style,
        }}
      >
        {children}
        {overlayScrollbar ? <OverlayScrollbar containerRef={bodyRef} /> : null}
      </div>
    </TableGridContext.Provider>
  );
}
