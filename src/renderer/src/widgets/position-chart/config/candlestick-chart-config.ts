import type { CSSProperties } from 'react';

export const DEFAULT_VISIBLE_BARS = 60;
export const HISTORY_FETCH_TRIGGER_BARS = 10;
export const HISTORY_FETCH_REARM_BARS = 30;
export const MIN_VISIBLE_BARS = 5;
export const ZOOM_IN_FACTOR = 0.7;
export const ZOOM_OUT_FACTOR = 1.4;

export const OVERLAY_BUTTON_STYLE: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.35)',
  backdropFilter: 'blur(1px)',
  WebkitBackdropFilter: 'blur(1px)',
  borderColor: 'rgba(0, 0, 0, 0.08)',
};
