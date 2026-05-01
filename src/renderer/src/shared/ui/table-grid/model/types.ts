import type { CSSProperties, MouseEvent, ReactNode } from 'react';

export type Align = 'left' | 'right' | 'center';

export type OverflowMode = 'nowrap' | 'ellipsis' | 'wrap' | 'scroll';

export type Variant = 'hts' | 'plain';

export type FlashDirection = 'up' | 'down';

export type CssLength = number | string;

/** Cell 공통 props — Header/Body 모두 사용 */
export interface CellProps {
  /** 컬럼 기준 폭. number는 기존 호환용 px, string은 rem 등 CSS length 그대로 사용한다. */
  width?: CssLength;
  /** flex grow 비율. width 미지정 시 적용. */
  flex?: number;
  minWidth?: CssLength;
  maxWidth?: CssLength;
  align?: Align;
  /** overflow 모드 — nowrap/ellipsis/wrap/scroll */
  overflow?: OverflowMode;
  /** mono + tabular-nums + align right shortcut */
  numeric?: boolean;
  /** sticky 컬럼 — 가로 스크롤 시 고정. right: 우측 고정(액션 컬럼 등) */
  sticky?: 'left' | 'right';
  /** 크기 조절 가능 여부 (기본값: true). Root의 설정이나 개별 컬럼에서 false로 끄면 리사이저가 나타나지 않음. */
  resizable?: boolean;
  /** 추가 CSS class */
  className?: string;
  /** inline style override */
  style?: CSSProperties;
  /** title attr (hover tooltip) */
  title?: string;
  /** 셀 내용 — 인터랙션 필요 시 children 에 <button> 등 직접 배치 */
  children?: ReactNode;
}

/** Row props — selected/expanded/flash 상태 + click */
export interface RowProps {
  selected?: boolean;
  expanded?: boolean;
  flash?: FlashDirection | null;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  /** 우클릭 컨텍스트 메뉴 핸들러 */
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  /**
   * 빈/로딩 placeholder row — sticky-left + viewport 너비(100cqw)로 고정해
   * 가로 스크롤 위치와 상관없이 보이는 영역 가운데에 메시지가 보이도록 함.
   */
  placeholder?: boolean;
  className?: string;
  style?: CSSProperties;
  /** 가상화 시 react key 보조 — DOM data-key */
  'data-key'?: string;
  /** @tanstack/react-virtual 측정용 index */
  'data-index'?: number;
  children?: ReactNode;
}

/** Root props — variant 선택 + sticky 헤더 + zebra */
export interface RootProps {
  variant?: Variant;
  /** sticky 헤더 (default true) */
  stickyHeader?: boolean;
  /** zebra 행 (variant=hts 에서만 효과 — default true) */
  zebra?: boolean;
  /** 컬럼 수직선 (variant=hts 에서 default true, plain 은 default false) */
  columnDividers?: boolean;
  /** OverlayScrollbar 자동 마운트 (default true) */
  overlayScrollbar?: boolean;
  /** 가로 스크롤 활성화 — Header + Body 를 공통 wrapper 로 가로 스크롤 (default false) */
  horizontalScroll?: boolean;
  /** 컬럼 사이즈 조절 활성화 (default true) */
  resizable?: boolean;
  /** 브라우저 LocalStorage에 컬럼 너비를 유지하기 위한 고유 키. 지정 시 새로고침해도 너비 유지. */
  storageKey?: string;
  /** 접근성 레이블 */
  'aria-label'?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Header props */
export interface HeaderProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Body props — virtualization 옵션 포함 */
export interface BodyProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}
