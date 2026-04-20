import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { OverlayScrollbarProps } from '../model/overlay-scrollbar-types';
import { useScrollState } from '../model/use-scroll-state';
import { useScrollbarInteraction } from '../model/use-scrollbar-interaction';

const MIN_THUMB_SIZE = 20;
const AUTO_HIDE_DELAY = 1500;
const SCROLLBAR_Z_INDEX = 200;

export function OverlayScrollbar({
  containerRef,
  orientation = 'vertical',
  autoHideDelay = AUTO_HIDE_DELAY,
  minThumbSize = MIN_THUMB_SIZE,
  offset,
}: OverlayScrollbarProps) {
  const shouldReduceMotion = useReducedMotion();
  const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } =
    useScrollState(containerRef);

  const isHorizontal = orientation === 'horizontal';

  // vertical 계산
  const hasVerticalScroll = scrollHeight > clientHeight;
  const thumbHeight = hasVerticalScroll
    ? Math.max(minThumbSize, (clientHeight / scrollHeight) * clientHeight)
    : 0;
  const maxScrollTop = scrollHeight - clientHeight;
  const maxThumbTop = clientHeight - thumbHeight;
  const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;

  // horizontal 계산
  const hasHorizontalScroll = scrollWidth > clientWidth;
  const thumbWidth = hasHorizontalScroll
    ? Math.max(minThumbSize, (clientWidth / scrollWidth) * clientWidth)
    : 0;
  const maxScrollLeft = scrollWidth - clientWidth;
  const maxThumbLeft = clientWidth - thumbWidth;
  const thumbLeft = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * maxThumbLeft : 0;

  const hasScroll = isHorizontal ? hasHorizontalScroll : hasVerticalScroll;
  const scrollPos = isHorizontal ? scrollLeft : scrollTop;

  const { isDragging, isVisible, handleThumbPointerDown, handleTrackPointerDown } =
    useScrollbarInteraction(
      containerRef,
      isHorizontal ? thumbWidth : thumbHeight,
      scrollPos,
      autoHideDelay,
      orientation,
    );

  if (!hasScroll) return null;

  const thumbColor = isDragging ? 'var(--accent)' : 'var(--fg-3)';
  const trackBg = isDragging ? 'var(--surface-hover)' : 'transparent';

  if (isHorizontal) {
    const thumbHeightStr = isDragging ? '0.7rem' : '0.4rem';

    const motionProps = shouldReduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: { duration: 0 },
        }
      : {
          initial: { opacity: 0, scaleY: 0.5 },
          animate: { opacity: 1, scaleY: 1 },
          exit: { opacity: 0, scaleY: 0.5 },
          transition: { duration: 0.2 },
        };

    return (
      // sticky wrapper: 스크롤 컨테이너 뷰포트 하단에 고정, 레이아웃 공간 차지 안함
      <div
        style={{
          position: 'sticky',
          bottom: offset?.bottom ?? 0,
          left: 0,
          width: 0,
          overflow: 'visible',
          zIndex: SCROLLBAR_Z_INDEX,
          pointerEvents: 'none',
        }}
      >
        <AnimatePresence>
          {isVisible && (
            <motion.div
              key="overlay-scrollbar-track-h"
              {...motionProps}
              style={{
                position: 'absolute',
                bottom: 0,
                left: offset?.left ?? 0,
                height: '0.6rem',
                width: clientWidth,
                backgroundColor: trackBg,
                borderRadius: '0.4rem',
                transformOrigin: 'bottom',
                touchAction: 'none',
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
              }}
              onPointerDown={handleTrackPointerDown}
            >
              <motion.div
                animate={{ height: thumbHeightStr }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 300, damping: 25 }
                }
                style={{
                  position: 'absolute',
                  left: thumbLeft + 4,
                  width: thumbWidth - 8,
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

  // vertical (기존 로직)
  const thumbWidthStr = isDragging ? '0.7rem' : '0.4rem';

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
              animate={{ width: thumbWidthStr }}
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
