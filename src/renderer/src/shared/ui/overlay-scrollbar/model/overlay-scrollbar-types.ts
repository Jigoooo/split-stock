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
  alwaysVisible?: boolean;
  offset?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
};
