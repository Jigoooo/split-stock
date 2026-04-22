import { AnimatePresence, type MotionStyle, motion, useReducedMotion } from 'framer-motion';
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type WidthMode = 'anchor' | 'content';
type PortalMode = 'body' | 'overlay';
type PopupAlign = 'end' | 'start';
type PopupSide = 'bottom' | 'top';

interface ControlPopupProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  onDismiss: (reason: 'escape' | 'outside-pointer') => void;
  children: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
  role?: string | undefined;
  style?: CSSProperties | undefined;
  widthMode?: WidthMode | undefined;
  animate?: boolean | undefined;
  minWidth?: number | undefined;
  offset?: number | undefined;
  portalMode?: PortalMode | undefined;
  zIndex?: number | undefined;
}

const VIEWPORT_PADDING = 8;

export function ControlPopup({
  open,
  anchorRef,
  popupRef,
  onDismiss,
  children,
  className,
  id,
  role,
  style,
  widthMode = 'anchor',
  animate = true,
  minWidth,
  offset = 6,
  portalMode = 'overlay',
  zIndex = 1080,
}: ControlPopupProps): ReactElement | null {
  const shouldReduceMotion = useReducedMotion();
  const scheduledFrameRef = useRef<number | null>(null);
  const [placement, setPlacement] = useState<{ align: PopupAlign; side: PopupSide }>({
    align: 'start',
    side: 'bottom',
  });
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  const portalTarget =
    typeof document === 'undefined'
      ? null
      : portalMode === 'body'
        ? document.body
        : ((anchorRef.current?.closest('.modal-overlay') as HTMLElement | null) ?? document.body);

  const updatePosition = useEffectEvent(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const popupWidth = popupRect.width || 0;
    const popupHeight = popupRect.height || 0;
    const nextWidth =
      widthMode === 'anchor'
        ? Math.max(anchorRect.width, minWidth ?? 0)
        : Math.max(minWidth ?? 0, popupWidth || anchorRect.width);

    const availableBelow = window.innerHeight - anchorRect.bottom - offset - VIEWPORT_PADDING;
    const availableAbove = anchorRect.top - offset - VIEWPORT_PADDING;
    const side: PopupSide =
      popupHeight <= availableBelow || availableBelow >= availableAbove ? 'bottom' : 'top';

    const availableRight = window.innerWidth - anchorRect.left - VIEWPORT_PADDING;
    const availableLeft = anchorRect.right - VIEWPORT_PADDING;
    const align: PopupAlign =
      nextWidth <= availableRight || availableRight >= availableLeft ? 'start' : 'end';

    let left = align === 'start' ? anchorRect.left : anchorRect.right - nextWidth;
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - nextWidth);
    left = Math.min(maxLeft, Math.max(VIEWPORT_PADDING, left));

    const preferredTop = anchorRect.bottom + offset;
    const aboveTop = anchorRect.top - popupHeight - offset;
    const unclampedTop = side === 'bottom' ? preferredTop : aboveTop;
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - VIEWPORT_PADDING - popupHeight);
    const top = Math.min(maxTop, Math.max(VIEWPORT_PADDING, unclampedTop));

    const nextStyle: CSSProperties = {
      left,
      minWidth: widthMode === 'content' ? nextWidth : undefined,
      position: 'fixed',
      top: Math.max(VIEWPORT_PADDING, top),
      transformOrigin: `${align === 'start' ? 'left' : 'right'} ${
        side === 'bottom' ? 'top' : 'bottom'
      }`,
      visibility: popupHeight > 0 ? 'visible' : 'hidden',
      width: widthMode === 'anchor' ? nextWidth : undefined,
      zIndex,
    };
    const placementChanged = placement.align !== align || placement.side !== side;

    if (
      !placementChanged &&
      popupStyle.left === nextStyle.left &&
      popupStyle.minWidth === nextStyle.minWidth &&
      popupStyle.position === nextStyle.position &&
      popupStyle.top === nextStyle.top &&
      popupStyle.visibility === nextStyle.visibility &&
      popupStyle.width === nextStyle.width &&
      popupStyle.zIndex === nextStyle.zIndex
    ) {
      return;
    }

    if (placementChanged) {
      setPlacement({ align, side });
    }
    setPopupStyle(nextStyle);
  });

  const schedulePositionUpdate = useEffectEvent(() => {
    if (scheduledFrameRef.current !== null) return;

    scheduledFrameRef.current = window.requestAnimationFrame(() => {
      scheduledFrameRef.current = null;
      updatePosition();
    });
  });

  useLayoutEffect(() => {
    if (!open || !portalTarget) return;
    updatePosition();
    schedulePositionUpdate();

    const onWindowChange = (): void => {
      schedulePositionUpdate();
    };

    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => schedulePositionUpdate());
    if (resizeObserver) {
      if (anchorRef.current) {
        resizeObserver.observe(anchorRef.current);
      }
      if (popupRef.current) {
        resizeObserver.observe(popupRef.current);
      }
    }

    return () => {
      if (scheduledFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledFrameRef.current);
        scheduledFrameRef.current = null;
      }
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
      resizeObserver?.disconnect();
    };
  }, [anchorRef, open, popupRef, portalTarget]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      onDismiss('outside-pointer');
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss('escape');
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, onDismiss, open, popupRef]);

  if (!portalTarget) return null;

  const motionProps =
    !animate || shouldReduceMotion
      ? {
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          initial: { opacity: 0 },
          transition: { duration: 0 },
        }
      : {
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.98, y: -4 },
          initial: { opacity: 0, scale: 0.98, y: -4 },
          transition: { duration: 0.14, ease: [0.2, 0, 0, 1] as [number, number, number, number] },
        };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          {...motionProps}
          ref={popupRef}
          data-align={placement.align}
          data-side={placement.side}
          className={className}
          id={id}
          role={role}
          style={{ ...popupStyle, ...(style ?? {}) } as MotionStyle}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalTarget,
  );
}
