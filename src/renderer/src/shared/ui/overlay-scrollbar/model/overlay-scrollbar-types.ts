import type { RefObject } from 'react';

export type ScrollSnapshot = Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}>;

export type OverlayScrollbarProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  autoHideDelay?: number;
  minThumbSize?: number;
  offset?: {
    top?: number;
    right?: number;
  };
};
