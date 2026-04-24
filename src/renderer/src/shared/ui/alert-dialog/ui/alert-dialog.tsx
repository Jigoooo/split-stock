import { Z_INDEX } from '@renderer/shared/config';
import { useColors } from '@renderer/shared/theme';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactElement } from 'react';
import { useEffect, useEffectEvent, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { DialogConfig, DialogTypeValue } from '../../dialog/model/dialog-types';
import { DialogMode, DialogType } from '../../dialog/model/dialog-types';
import { OverlayType, overlayStackActions, pushOverlayHistoryState } from '../../overlay-stack';

const DESTRUCTIVE_TYPES = new Set<DialogTypeValue>([DialogType.WARNING, DialogType.ERROR]);

function getTypeAccent(type: DialogTypeValue, colors: ReturnType<typeof useColors>): string {
  switch (type) {
    case DialogType.SUCCESS:
      return colors.feedback.success;
    case DialogType.WARNING:
      return colors.feedback.warning;
    case DialogType.ERROR:
      return colors.feedback.error;
    default:
      return colors.interactive.primary;
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

      if (event.key === 'Enter') {
        event.preventDefault();
        closeWithHistory(true);
      } else if (event.key === 'Escape' && isOverlayPressClose) {
        event.preventDefault();
        closeWithHistory(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isOverlayPressClose]);

  if (!isOpen) return null;

  const accentColor = getTypeAccent(type, colors);
  const isDestructive = DESTRUCTIVE_TYPES.has(type);

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: Z_INDEX.ALERT_BACKDROP,
              backgroundColor: colors.overlay.modalBackdrop,
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => {
              if (isOverlayPressClose && isTopOverlay()) closeWithHistory(false);
            }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'app-dialog-title' : undefined}
            initial={{ opacity: 0, scale: 1.08, x: '-50%', y: '-50%' }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%', pointerEvents: 'auto' }}
            exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%', pointerEvents: 'none' }}
            transition={{ type: 'spring', damping: 20, stiffness: 380, mass: 0.8 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              zIndex: Z_INDEX.ALERT,
              width: '27rem',
              maxWidth: 'calc(100vw - 4rem)',
              backgroundColor: `color-mix(in srgb, ${colors.bg.elevated} 92%, ${accentColor} 8%)`,
              border: `1px solid ${colors.border.default}`,
              borderRadius: '1.4rem',
              overflow: 'hidden',
              boxShadow: `0 24px 64px ${colors.shadow.modal}`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                padding: '2rem 2rem 0.8rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              {title ? (
                <h2
                  id="app-dialog-title"
                  style={{
                    fontSize: '1.7rem',
                    fontWeight: 600,
                    color: colors.text.primary,
                    lineHeight: 1.25,
                  }}
                >
                  {title}
                </h2>
              ) : null}
              {message ? (
                <div style={{ fontSize: '1.3rem', color: colors.text.secondary, lineHeight: 1.45 }}>
                  {message}
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: mode === DialogMode.CONFIRM ? 'row-reverse' : 'column',
                gap: '0.8rem',
                padding: '1.2rem 1.6rem 1.6rem',
              }}
            >
              {renderActions ? (
                renderActions(() => closeWithHistory(false))
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => closeWithHistory(true)}
                    style={{
                      flex: mode === DialogMode.CONFIRM ? 1 : undefined,
                      height: '4rem',
                      border: 'none',
                      borderRadius: '1rem',
                      background: isDestructive ? accentColor : colors.interactive.primary,
                      fontSize: '1.5rem',
                      fontWeight: 600,
                      color: colors.text.onBrand,
                      cursor: 'pointer',
                    }}
                  >
                    {confirmText}
                  </button>
                  {mode === DialogMode.CONFIRM ? (
                    <button
                      type="button"
                      onClick={() => closeWithHistory(false)}
                      style={{
                        flex: 1,
                        height: '4rem',
                        border: `1px solid ${colors.border.default}`,
                        borderRadius: '1rem',
                        background: colors.bg.elevated,
                        fontSize: '1.5rem',
                        fontWeight: 600,
                        color: colors.text.primary,
                        cursor: 'pointer',
                      }}
                    >
                      {cancelText}
                    </button>
                  ) : null}
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
