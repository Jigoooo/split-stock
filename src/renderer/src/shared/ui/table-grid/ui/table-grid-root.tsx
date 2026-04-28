import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { OverlayScrollbar } from '../../overlay-scrollbar';
import type { RootProps, Variant } from '../model/types';

interface TableGridContextValue {
  variant: Variant;
  stickyHeader: boolean;
  zebra: boolean;
  columnDividers: boolean;
  overlayScrollbar: boolean;
  horizontalScroll: boolean;
  /** 컬럼 리사이즈 활성화 여부 */
  resizable: boolean;
  /** Body 가 등록한 scroll container ref — Root 가 OverlayScrollbar 에 전달 */
  bodyRef: React.RefObject<HTMLDivElement | null>;
  /** horizontalScroll=true 시 Header+Body 를 감싸는 가로 스크롤 wrapper ref */
  hScrollRef: React.RefObject<HTMLDivElement | null>;
  /** width prop 을 min-width 로 보고, 실제 더 넓은 콘텐츠를 컬럼 전체에 공유 */
  columnWidths: Record<number, number>;
  reportColumnWidth: (columnIndex: number, width: number) => void;
  /** 사용자가 드래그하여 수동으로 설정한 너비 (이 값이 우선 적용됨) */
  manualColumnWidths: Record<number, number>;
  setManualColumnWidth: (columnIndex: number, width: number) => void;
  /** 수동 너비 초기화 (localStorage도 함께 제거) */
  resetColumnWidths: () => void;
  /** storageKey가 설정되어 있는지 여부 (초기화 버튼 표시 조건) */
  hasStorageKey: boolean;
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
    resizable = true,
    storageKey,
    'aria-label': ariaLabel,
    className,
    style,
    children,
  } = props;

  const columnDividers = props.columnDividers ?? variant === 'hts';

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  
  // 초기 렌더링 시 로컬 스토리지에서 수동 너비 가져오기
  const [manualColumnWidths, setManualColumnWidths] = useState<Record<number, number>>(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(`table-grid-cols-${storageKey}`);
        if (stored) {
          return JSON.parse(stored);
        }
      } catch (e) {
        console.warn('Failed to parse table grid column widths from localStorage', e);
      }
    }
    return {};
  });

  const setManualColumnWidth = useCallback((columnIndex: number, width: number) => {
    setManualColumnWidths((prev) => {
      const next = {
        ...prev,
        [columnIndex]: Math.max(30, Math.round(width)), // 최소 30px
      };
      
      if (storageKey) {
        try {
          localStorage.setItem(`table-grid-cols-${storageKey}`, JSON.stringify(next));
        } catch (e) {
          console.warn('Failed to save table grid column widths to localStorage', e);
        }
      }
      
      return next;
    });
  }, [storageKey]);

  const resetColumnWidths = useCallback(() => {
    setManualColumnWidths({});
    if (storageKey) {
      try {
        localStorage.removeItem(`table-grid-cols-${storageKey}`);
      } catch (e) {
        console.warn('Failed to remove table grid column widths from localStorage', e);
      }
    }
  }, [storageKey]);

  const reportColumnWidth = useCallback((columnIndex: number, width: number) => {
    if (!Number.isFinite(width) || width <= 0) return;

    setColumnWidths((prev) => {
      const nextWidth = Math.ceil(width);
      if ((prev[columnIndex] ?? 0) >= nextWidth) {
        return prev;
      }

      return {
        ...prev,
        [columnIndex]: nextWidth,
      };
    });
  }, []);

  const ctx = useMemo<TableGridContextValue>(
    () => ({
      variant,
      stickyHeader,
      zebra,
      columnDividers,
      overlayScrollbar,
      horizontalScroll,
      resizable,
      bodyRef,
      hScrollRef,
      columnWidths,
      reportColumnWidth,
      manualColumnWidths,
      setManualColumnWidth,
      resetColumnWidths,
      hasStorageKey: storageKey !== undefined,
    }),
    [
      variant,
      stickyHeader,
      zebra,
      columnDividers,
      overlayScrollbar,
      horizontalScroll,
      resizable,
      columnWidths,
      reportColumnWidth,
      manualColumnWidths,
      setManualColumnWidth,
      resetColumnWidths,
      storageKey,
    ],
  );

  const hasStorageKey = storageKey !== undefined;
  const hasManualWidths = Object.keys(manualColumnWidths).length > 0;

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
          // 100cqw(컨테이너 쿼리 가로) 단위로 placeholder row 가 viewport 너비에 정렬됨
          containerType: 'inline-size',
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
              // 브라우저 기본 스크롤바 숨김 (OverlayScrollbar 사용)
              scrollbarWidth: 'none',
            }}
          >
            {/*
             * inner content — width:max-content 로 Header/Body 폭을 실제 컬럼 합계까지
             * 확장하고, min-width:100% 로 viewport 보다 좁을 때만 stretch 한다.
             * fit-content 는 브라우저에 따라 가용 폭 기준으로 clamp 되어 scrollWidth 가
             * 마지막 컬럼까지 잡히지 않는 경우가 있어, max-content 로 고정한다.
             */}
            <div
              className="table-grid-hscroll-content"
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 'max-content',
                minWidth: '100%',
                minHeight: '100%',
              }}
            >
              {children}
            </div>
          </div>
        ) : (
          <>
            {children}
            {overlayScrollbar ? <OverlayScrollbar containerRef={bodyRef} alwaysVisible /> : null}
          </>
        )}
        {horizontalScroll && overlayScrollbar ? (
          <>
            <OverlayScrollbar containerRef={hScrollRef} alwaysVisible />
            <OverlayScrollbar containerRef={hScrollRef} orientation="horizontal" alwaysVisible />
          </>
        ) : null}
        {hasStorageKey && hasManualWidths ? (
          <button
            type="button"
            title="컬럼 너비 초기화"
            onClick={resetColumnWidths}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'var(--bg-elevated, rgba(255,255,255,0.9))',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.2rem',
              height: '2.2rem',
              padding: 0,
              position: 'absolute',
              top: '0.2rem',
              right: '0.2rem',
              zIndex: 10,
              borderRadius: '0.4rem',
              color: 'var(--text-secondary, #888)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
              opacity: 0.7,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.7';
            }}
          >
            <svg
              width="13"
              height="13"
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
    </TableGridContext.Provider>
  );
}
