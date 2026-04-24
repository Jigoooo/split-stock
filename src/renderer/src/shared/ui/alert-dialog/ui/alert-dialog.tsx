import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useEffectEvent, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '../../../constants';
import { useColors } from '../../../theme';
import type { DialogConfig, DialogTypeValue } from '../../dialog/model/dialog-types';
import { DialogMode, DialogType } from '../../dialog/model/dialog-types';
import { OverlayType, overlayStackActions, pushOverlayHistoryState } from '../../overlay-stack';

const TYPE_ICON: Record<DialogTypeValue, LucideIcon> = {
  [DialogType.INFO]: Info,
  [DialogType.SUCCESS]: CheckCircle2,
  [DialogType.WARNING]: AlertTriangle,
  [DialogType.ERROR]: AlertCircle,
};

const TYPE_TITLE: Record<DialogTypeValue, string> = {
  [DialogType.INFO]: '알림',
  [DialogType.SUCCESS]: '성공',
  [DialogType.WARNING]: '경고',
  [DialogType.ERROR]: '오류',
};

function getTypeAccent(type: DialogTypeValue, colors: ReturnType<typeof useColors>): string {
  switch (type) {
    case DialogType.SUCCESS:
      return colors.feedback.success;
    case DialogType.WARNING:
      return colors.feedback.warning;
    case DialogType.ERROR:
      return colors.feedback.error;
    default:
      return colors.feedback.info;
  }
}

function createOverlayId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `alert-${crypto.randomUUID()}`;
  }

  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type AlertDialogRendererProps = {
  config: DialogConfig;
};

export function AlertDialogRenderer({ config }: AlertDialogRendererProps): ReactElement | null {
  const colors = useColors();
  const dialogRef = useRef<HTMLDivElement>(null);
  const historyIdRef = useRef<string | null>(null);
  const ignoreOverlayResolveRef = useRef(false);
  const latestCancelRef = useRef(config.onCancel);
  const {
    isOpen,
    mode,
    type,
    isOverlayPressClose,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    renderActions,
  } = config;

  latestCancelRef.current = onCancel;

  useEffect(() => {
    if (isOpen) {
      if (historyIdRef.current) return;

      const id = createOverlayId();
      historyIdRef.current = id;
      pushOverlayHistoryState(id);
      overlayStackActions.push(id, OverlayType.Alert, () => {
        if (ignoreOverlayResolveRef.current) {
          ignoreOverlayResolveRef.current = false;
          return;
        }
        latestCancelRef.current();
      });
      return;
    }

    const id = historyIdRef.current;
    historyIdRef.current = null;
    if (id && overlayStackActions.has(id)) {
      ignoreOverlayResolveRef.current = true;
      overlayStackActions.closeWithBack(id);
    }
  }, [isOpen]);

  const isTopOverlay = useEffectEvent((): boolean => {
    const id = historyIdRef.current;
    return id === null || overlayStackActions.peek()?.id === id;
  });

  const closeWithHistory = useEffectEvent((result: boolean) => {
    const id = historyIdRef.current;
    historyIdRef.current = null;
    ignoreOverlayResolveRef.current = true;

    if (result) {
      onConfirm();
    } else {
      onCancel();
    }

    if (id && overlayStackActions.has(id)) {
      overlayStackActions.closeWithBack(id);
      return;
    }

    ignoreOverlayResolveRef.current = false;
  });

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTopOverlay()) return;

      if (event.key === 'Escape' && isOverlayPressClose) {
        event.preventDefault();
        closeWithHistory(false);
        return;
      }

      if (event.key === 'Enter') {
        const target = event.target;
        if (target instanceof HTMLElement && target.tagName === 'TEXTAREA') {
          return;
        }
        event.preventDefault();
        closeWithHistory(true);
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (focusables.length === 0) return;

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          return;
        }

        if (document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isOverlayPressClose]);

  if (!isOpen) return null;

  const Icon = TYPE_ICON[type];
  const accentColor = getTypeAccent(type, colors);
  const displayTitle = title && title !== '알림' ? title : TYPE_TITLE[type];
  const destructive = type === DialogType.ERROR || type === DialogType.WARNING;

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: Z_INDEX.ALERT_BACKDROP,
              backgroundColor: colors.overlay.modalBackdrop,
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
          />
          {isOverlayPressClose ? (
            <button
              type="button"
              aria-label="닫기"
              onClick={() => {
                if (isTopOverlay()) {
                  closeWithHistory(false);
                }
              }}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: Z_INDEX.ALERT_BACKDROP,
                border: 0,
                padding: 0,
                background: 'transparent',
                cursor: 'default',
              }}
            />
          ) : null}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            initial={{ opacity: 0, scale: 1.04, x: '-50%', y: '-48%' }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
            exit={{ opacity: 0, scale: 0.98, x: '-50%', y: '-48%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.82 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              zIndex: Z_INDEX.ALERT,
              width: 'min(44rem, calc(100vw - 3.2rem))',
              minWidth: 'min(32rem, calc(100vw - 3.2rem))',
              borderRadius: '1.8rem',
              border: `1px solid ${colors.border.default}`,
              background: `linear-gradient(180deg, ${colors.bg.elevated}, ${colors.bg.subtle})`,
              boxShadow: `0 24px 64px ${colors.shadow.modal}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1.6rem 1.8rem 1rem',
                borderBottom: `1px solid ${colors.border.default}`,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '3.2rem',
                  height: '3.2rem',
                  flexShrink: 0,
                  borderRadius: '999px',
                  background: `color-mix(in srgb, ${accentColor} 14%, ${colors.bg.elevated})`,
                  color: accentColor,
                }}
              >
                <Icon size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  id="app-dialog-title"
                  style={{
                    color: colors.text.primary,
                    fontSize: '1.55rem',
                    fontWeight: 700,
                    lineHeight: 1.25,
                  }}
                >
                  {displayTitle}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '1.4rem 1.8rem 1.2rem',
                color: colors.text.secondary,
                fontSize: '1.3rem',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'keep-all',
              }}
            >
              {message}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.9rem',
                justifyContent: 'stretch',
                padding: '0 1.6rem 1.6rem',
              }}
            >
              {renderActions ? (
                renderActions(() => closeWithHistory(false))
              ) : (
                <>
                  {mode === DialogMode.CONFIRM ? (
                    <button
                      type="button"
                      onClick={() => closeWithHistory(false)}
                      style={{
                        flex: '1 1 0',
                        minHeight: '4.2rem',
                        borderRadius: '1.1rem',
                        border: `1px solid ${colors.border.default}`,
                        background: colors.bg.elevated,
                        color: colors.text.primary,
                        fontSize: '1.3rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {cancelText}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => closeWithHistory(true)}
                    style={{
                      flex: '1 1 0',
                      minHeight: '4.2rem',
                      borderRadius: '1.1rem',
                      border: `1px solid ${destructive ? accentColor : colors.interactive.primary}`,
                      background: destructive ? accentColor : colors.interactive.primary,
                      color: colors.text.onBrand,
                      fontSize: '1.3rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {confirmText}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
