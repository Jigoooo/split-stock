import { type RefObject, useEffect, useEffectEvent } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UseDialogFocusParams<
  TRoot extends HTMLElement = HTMLElement,
  TInitial extends HTMLElement = HTMLElement,
> {
  enabled: boolean;
  rootRef: RefObject<TRoot | null>;
  initialFocusRef?: RefObject<TInitial | null> | undefined;
  onEscape?: (() => void) | undefined;
  canHandleEscape?: (() => boolean) | undefined;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('disabled')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

export function useDialogFocus<
  TRoot extends HTMLElement = HTMLElement,
  TInitial extends HTMLElement = HTMLElement,
>({
  enabled,
  rootRef,
  initialFocusRef,
  onEscape,
  canHandleEscape,
}: UseDialogFocusParams<TRoot, TInitial>): void {
  const handleEscape = useEffectEvent((): boolean => {
    if (!onEscape || !(canHandleEscape?.() ?? true)) return false;
    onEscape();
    return true;
  });

  useEffect(() => {
    if (!enabled) return;

    const root = rootRef.current;
    if (!root) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? getFocusableElements(root)[0] ?? root;
      target.focus();
    });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && handleEscape()) {
        event.preventDefault();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [enabled, initialFocusRef, rootRef]);
}
