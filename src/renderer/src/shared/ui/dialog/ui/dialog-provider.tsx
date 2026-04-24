import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../button';
import { useDialogStore } from '../model/dialog-store';
import { DialogMode, DialogType, type DialogTypeValue } from '../model/dialog-types';

const TYPE_CLASS: Record<DialogTypeValue, string> = {
  [DialogType.INFO]: 'app-dialog--info',
  [DialogType.SUCCESS]: 'app-dialog--success',
  [DialogType.WARNING]: 'app-dialog--warning',
  [DialogType.ERROR]: 'app-dialog--error',
};

const TYPE_TITLE: Record<DialogTypeValue, string> = {
  [DialogType.INFO]: '알림',
  [DialogType.SUCCESS]: '성공',
  [DialogType.WARNING]: '경고',
  [DialogType.ERROR]: '오류',
};

const TYPE_ICON: Record<DialogTypeValue, ReactElement> = {
  [DialogType.INFO]: <Info size={20} aria-hidden />,
  [DialogType.SUCCESS]: <CheckCircle2 size={20} aria-hidden />,
  [DialogType.WARNING]: <AlertTriangle size={20} aria-hidden />,
  [DialogType.ERROR]: <AlertCircle size={20} aria-hidden />,
};

/**
 * 함수형 dialog의 단일 mount 지점.
 * AppProviders 트리에 한 번만 배치한다.
 */
export const DialogProvider = (): ReactElement | null => {
  const config = useDialogStore((s) => s.dialogConfig);
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

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOverlayPressClose) {
        e.preventDefault();
        onCancel();
        return;
      }
      // 포커스 트랩 (Tab 순환)
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isOverlayPressClose, onCancel]);

  if (!isOpen) return null;

  const variantClass = TYPE_CLASS[type];
  const displayTitle = title && title !== '알림' ? title : TYPE_TITLE[type];

  const content = (
    <div className="modal-overlay app-dialog-overlay">
      {isOverlayPressClose ? (
        <button
          type="button"
          aria-label="닫기"
          className="app-dialog-overlay__backdrop"
          onClick={onCancel}
        />
      ) : null}
      <div
        ref={dialogRef}
        className={`app-dialog ${variantClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <div className="app-dialog__title" id="app-dialog-title">
          <span className="app-dialog__icon">{TYPE_ICON[type]}</span>
          <span>{displayTitle}</span>
        </div>
        <div className="app-dialog__body">{message}</div>
        <div className="app-dialog__actions">
          {renderActions ? (
            renderActions(onCancel)
          ) : (
            <>
              {mode === DialogMode.CONFIRM ? (
                <Button onClick={onCancel} dense>
                  {cancelText}
                </Button>
              ) : null}
              <Button
                onClick={onConfirm}
                variant={
                  type === DialogType.ERROR || type === DialogType.WARNING ? 'danger' : 'primary'
                }
                dense
                autoFocus
              >
                {confirmText}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
