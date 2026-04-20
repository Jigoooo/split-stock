import { type RefObject, useRef, useSyncExternalStore } from 'react';

import type { ScrollSnapshot } from './overlay-scrollbar-types';

const defaultSnapshot: ScrollSnapshot = Object.freeze({
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
  scrollLeft: 0,
  scrollWidth: 0,
  clientWidth: 0,
});

function snapshotEquals(a: ScrollSnapshot, b: ScrollSnapshot) {
  return (
    a.scrollTop === b.scrollTop &&
    a.scrollHeight === b.scrollHeight &&
    a.clientHeight === b.clientHeight &&
    a.scrollLeft === b.scrollLeft &&
    a.scrollWidth === b.scrollWidth &&
    a.clientWidth === b.clientWidth
  );
}

export function useScrollState(containerRef: RefObject<HTMLDivElement | null>): ScrollSnapshot {
  const snapshotRef = useRef<ScrollSnapshot>(defaultSnapshot);

  return useSyncExternalStore(
    (onStoreChange) => {
      const el = containerRef.current;
      if (!el) return () => {};

      let raf = 0;

      const notify = () => {
        const next: ScrollSnapshot = {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollLeft: el.scrollLeft,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };

        if (!snapshotEquals(snapshotRef.current, next)) {
          snapshotRef.current = next;
          if (!raf) {
            raf = requestAnimationFrame(() => {
              raf = 0;
              onStoreChange();
            });
          }
        }
      };

      el.addEventListener('scroll', notify, { passive: true });
      const ro = new ResizeObserver(notify);
      ro.observe(el);

      notify();

      return () => {
        if (raf) cancelAnimationFrame(raf);
        el.removeEventListener('scroll', notify);
        ro.disconnect();
      };
    },
    () => snapshotRef.current,
  );
}
