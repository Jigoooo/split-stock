import type { RefObject } from 'react';

export type ScrollSnapshot = Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}>;

export type OverlayScrollbarProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  orientation?: 'vertical' | 'horizontal';
  autoHideDelay?: number;
  minThumbSize?: number;
  /** 스크롤 가능한 경우 thumb/track 을 자동 숨김 없이 표시한다. default true */
  alwaysVisible?: boolean;
  offset?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
};
