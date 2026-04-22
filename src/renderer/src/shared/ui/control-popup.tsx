import { AnimatePresence, type MotionStyle, motion, useReducedMotion } from 'framer-motion';
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type WidthMode = 'anchor' | 'content';

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
  minWidth?: number | undefined;
  offset?: number | undefined;
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
  minWidth,
  offset = 6,
  zIndex = 1080,
}: ControlPopupProps): ReactElement | null {
  const shouldReduceMotion = useReducedMotion();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  });

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

    let left = anchorRect.left;
    if (left + nextWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - nextWidth);
    }
    left = Math.max(VIEWPORT_PADDING, left);

    const preferredTop = anchorRect.bottom + offset;
    const fitsBelow = preferredTop + popupHeight <= window.innerHeight - VIEWPORT_PADDING;
    const aboveTop = anchorRect.top - popupHeight - offset;
    const top = !fitsBelow && aboveTop >= VIEWPORT_PADDING ? aboveTop : preferredTop;

    const nextStyle: CSSProperties = {
      left,
      minWidth: widthMode === 'content' ? nextWidth : undefined,
      position: 'fixed',
      top: Math.max(VIEWPORT_PADDING, top),
      visibility: popupHeight > 0 ? 'visible' : 'hidden',
      width: widthMode === 'anchor' ? nextWidth : undefined,
      zIndex,
    };

    if (
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
    setPopupStyle(nextStyle);
  });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    setPortalTarget((anchor.closest('.modal-overlay') as HTMLElement | null) ?? document.body);
  }, [anchorRef, open]);

  useLayoutEffect(() => {
    if (!open || !portalTarget) return;
    updatePosition();

    const frame = window.requestAnimationFrame(() => {
      updatePosition();
    });

    const onWindowChange = (): void => {
      updatePosition();
    };

    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [open, portalTarget]);

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

  const motionProps = shouldReduceMotion
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
