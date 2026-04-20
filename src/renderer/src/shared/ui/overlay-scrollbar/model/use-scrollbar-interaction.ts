import { type RefObject, useEffect, useEffectEvent, useState } from 'react';

export function useScrollbarInteraction(
  containerRef: RefObject<HTMLDivElement | null>,
  thumbHeight: number,
  scrollTop: number,
  autoHideDelay: number,
) {
  const [isDragging, setIsDragging] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // isDragging 중이면 렌더 중 isVisible 보장
  if (isDragging && !isVisible) {
    setIsVisible(true);
  }

  // 사용자 입력 이벤트(wheel, touch)로만 스크롤바 표시
  // — 프로그래밍 방식 스크롤(scrollToIndex 등)에서는 스크롤바가 나타나지 않음
  const showScrollbar = useEffectEvent(() => {
    if (!isVisible) {
      setIsVisible(true);
    }
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const show = () => showScrollbar();

    el.addEventListener('wheel', show, { passive: true });
    el.addEventListener('touchstart', show, { passive: true });

    return () => {
      el.removeEventListener('wheel', show);
      el.removeEventListener('touchstart', show);
    };
  }, [containerRef]);

  // 자동 숨김 타이머 — scrollTop이 deps에 있으므로 스크롤 중에는 타이머 재시작
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollTop은 타이머 재시작을 위한 의도적 의존성
  useEffect(() => {
    if (!isVisible || isDragging) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
    }, autoHideDelay);

    return () => clearTimeout(timer);
  }, [scrollTop, isVisible, isDragging, autoHideDelay]);

  const handleThumbPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const el = containerRef.current;
    if (!el) return;

    const startY = e.clientY;
    const initialScrollTop = el.scrollTop;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    const maxThumbTop = el.clientHeight - thumbHeight;

    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      const deltaY = ev.clientY - startY;
      const scrollRatio = maxThumbTop > 0 ? maxScrollTop / maxThumbTop : 0;
      const newScrollTop = initialScrollTop + deltaY * scrollRatio;
      el.scrollTop = Math.max(0, Math.min(newScrollTop, maxScrollTop));
    };

    const onPointerUp = (ev: PointerEvent) => {
      setIsDragging(false);
      (ev.target as HTMLElement).releasePointerCapture(ev.pointerId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickRatio = clickY / rect.height;
    const maxScrollTop = el.scrollHeight - el.clientHeight;

    el.scrollTop = clickRatio * maxScrollTop;
  };

  return {
    isDragging,
    isVisible,
    handleThumbPointerDown,
    handleTrackPointerDown,
  };
}
