import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { OverlayScrollbarProps } from '../model/overlay-scrollbar-types';
import { useScrollState } from '../model/use-scroll-state';
import { useScrollbarInteraction } from '../model/use-scrollbar-interaction';

const MIN_THUMB_SIZE = 20;
const AUTO_HIDE_DELAY = 1500;
const SCROLLBAR_Z_INDEX = 200;

export function OverlayScrollbar({
  containerRef,
  autoHideDelay = AUTO_HIDE_DELAY,
  minThumbSize = MIN_THUMB_SIZE,
  offset,
}: OverlayScrollbarProps) {
  const shouldReduceMotion = useReducedMotion();
  const { scrollTop, scrollHeight, clientHeight } = useScrollState(containerRef);

  const hasScroll = scrollHeight > clientHeight;
  const thumbHeight = hasScroll
    ? Math.max(minThumbSize, (clientHeight / scrollHeight) * clientHeight)
    : 0;
  const maxScrollTop = scrollHeight - clientHeight;
  const maxThumbTop = clientHeight - thumbHeight;
  const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;

  const { isDragging, isVisible, handleThumbPointerDown, handleTrackPointerDown } =
    useScrollbarInteraction(containerRef, thumbHeight, scrollTop, autoHideDelay);

  if (!hasScroll) return null;

  const thumbColor = isDragging ? 'var(--accent)' : 'var(--fg-3)';
  const trackBg = isDragging ? 'var(--surface-hover)' : 'transparent';
  const thumbWidth = isDragging ? '0.7rem' : '0.4rem';

  const motionProps = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0, scaleX: 0.5 },
        animate: { opacity: 1, scaleX: 1 },
        exit: { opacity: 0, scaleX: 0.5 },
        transition: { duration: 0.2 },
      };

  return (
    // sticky wrapper: 스크롤 컨테이너 뷰포트 상단에 고정, 레이아웃 공간 차지 안함
    <div
      style={{
        position: 'sticky',
        top: offset?.top ?? 0,
        float: 'right',
        height: 0,
        overflow: 'visible',
        zIndex: SCROLLBAR_Z_INDEX,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key="overlay-scrollbar-track"
            {...motionProps}
            style={{
              position: 'absolute',
              top: 0,
              right: offset?.right ?? 0,
              width: '0.6rem',
              height: clientHeight,
              backgroundColor: trackBg,
              borderRadius: '0.4rem',
              transformOrigin: 'right',
              touchAction: 'none',
              pointerEvents: 'auto',
              display: 'flex',
              justifyContent: 'center',
            }}
            onPointerDown={handleTrackPointerDown}
          >
            <motion.div
              animate={{ width: thumbWidth }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 25 }
              }
              style={{
                position: 'absolute',
                top: thumbTop + 4,
                height: thumbHeight - 8,
                backgroundColor: thumbColor,
                borderRadius: '0.4rem',
                cursor: 'pointer',
                touchAction: 'none',
              }}
              onPointerDown={handleThumbPointerDown}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
