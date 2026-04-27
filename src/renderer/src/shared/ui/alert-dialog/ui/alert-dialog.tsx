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

  const defaultAccentColor = getTypeAccent(config.type, colors);
  const accentColor = config.accentColor ?? defaultAccentColor;
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
            initial={{ opacity: 0, scale: 1.05, x: '-50%', y: '-50%' }}
            animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%', pointerEvents: 'auto' }}
            exit={{ opacity: 0, scale: 0.98, x: '-50%', y: '-50%', pointerEvents: 'none' }}
            transition={{ type: 'spring', damping: 22, stiffness: 400, mass: 0.8 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              zIndex: Z_INDEX.ALERT,
              width: 'fit-content',
              minWidth: '28rem',
              maxWidth: 'calc(100vw - 3rem)',
              backgroundColor: colors.bg.elevated,
              border: `1px solid ${colors.border.default}`,
              borderRadius: '1rem',
              overflow: 'hidden',
              boxShadow: `0 16px 40px ${colors.shadow.modal}`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {title ? (
              <div
                style={{
                  padding: '1.2rem 1.6rem',
                  backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
                  borderBottom: `1px solid color-mix(in srgb, ${accentColor} 12%, ${colors.border.default})`,
                }}
              >
                <h2
                  id="app-dialog-title"
                  style={{
                    fontSize: '1.4rem',
                    fontWeight: 600,
                    color: colors.text.primary,
                    lineHeight: 1.3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    margin: 0,
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: accentColor,
                    }}
                  />
                  {title}
                </h2>
              </div>
            ) : null}
            <div
              style={{
                padding: '1.6rem',
              }}
            >
              {message ? (
                <div
                  style={{
                    fontSize: '1.3rem',
                    color: colors.text.secondary,
                    lineHeight: 1.5,
                    wordBreak: 'keep-all',
                  }}
                >
                  {message}
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.6rem',
                padding: '0 1.6rem 1.4rem',
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
                        padding: '0 1.4rem',
                        height: '3.4rem',
                        border: `1px solid ${colors.border.default}`,
                        borderRadius: '0.6rem',
                        background: colors.bg.elevated,
                        fontSize: '1.3rem',
                        fontWeight: 500,
                        color: colors.text.primary,
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
                      padding: '0 1.4rem',
                      height: '3.4rem',
                      border: 'none',
                      borderRadius: '0.6rem',
                      background: config.accentColor
                        ? accentColor
                        : isDestructive
                          ? accentColor
                          : colors.interactive.primary,
                      fontSize: '1.3rem',
                      fontWeight: 600,
                      color: colors.text.onBrand,
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
