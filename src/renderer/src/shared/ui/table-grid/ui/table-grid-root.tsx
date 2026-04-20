import { createContext, type ReactElement, useContext, useMemo, useRef } from 'react';
import { OverlayScrollbar } from '../../overlay-scrollbar';
import type { RootProps, Variant } from '../model/types';

interface TableGridContextValue {
  variant: Variant;
  stickyHeader: boolean;
  zebra: boolean;
  columnDividers: boolean;
  overlayScrollbar: boolean;
  horizontalScroll: boolean;
  /** Body 가 등록한 scroll container ref — Root 가 OverlayScrollbar 에 전달 */
  bodyRef: React.RefObject<HTMLDivElement | null>;
  /** horizontalScroll=true 시 Header+Body 를 감싸는 가로 스크롤 wrapper ref */
  hScrollRef: React.RefObject<HTMLDivElement | null>;
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
 * - horizontalScroll=true 시 내부 wrapper 가 overflowX:auto + horizontal OverlayScrollbar
 */
export function TableGridRoot(props: RootProps): ReactElement {
  const {
    variant = 'plain',
    stickyHeader = true,
    zebra = true,
    overlayScrollbar = true,
    horizontalScroll = false,
    'aria-label': ariaLabel,
    className,
    style,
    children,
  } = props;

  const columnDividers = props.columnDividers ?? variant === 'hts';

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);

  const ctx = useMemo<TableGridContextValue>(
    () => ({
      variant,
      stickyHeader,
      zebra,
      columnDividers,
      overlayScrollbar,
      horizontalScroll,
      bodyRef,
      hScrollRef,
    }),
    [variant, stickyHeader, zebra, columnDividers, overlayScrollbar, horizontalScroll],
  );

  return (
    <TableGridContext.Provider value={ctx}>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role=region supports aria-label */}
      <div
        data-variant={variant}
        data-sticky-header={stickyHeader}
        data-zebra={zebra}
        data-column-dividers={columnDividers}
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
        {horizontalScroll ? (
          // 가로+세로 스크롤 wrapper — Header + Body 를 함께 감싸 sync 유지
          // overflow: auto (양방향) → Header sticky top 이 wrapper 기준으로 고정되면서
          // 가로 스크롤 시 Header 도 자연히 같이 이동 (별도 JS sync 불필요)
          <div
            ref={hScrollRef}
            className="table-grid-hscroll-wrapper"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              // 브라우저 기본 스크롤바 숨김 (OverlayScrollbar 사용)
              scrollbarWidth: 'none',
            }}
          >
            {children}
          </div>
        ) : (
          <>
            {children}
            {overlayScrollbar ? <OverlayScrollbar containerRef={bodyRef} /> : null}
          </>
        )}
        {/* horizontalScroll=true 시: wrapper 가 세로+가로 모두 담당 → 두 방향 모두 부착 */}
        {horizontalScroll && overlayScrollbar ? (
          <>
            <OverlayScrollbar containerRef={hScrollRef} />
            <OverlayScrollbar containerRef={hScrollRef} orientation="horizontal" />
          </>
        ) : null}
      </div>
    </TableGridContext.Provider>
  );
}
