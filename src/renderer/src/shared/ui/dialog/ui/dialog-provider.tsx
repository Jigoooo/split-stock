import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../button';
import { useDialogStore } from '../model/dialog-store';
import { DialogType, type DialogTypeValue } from '../model/dialog-types';

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

const TYPE_ICON: Record<DialogTypeValue, string> = {
  [DialogType.INFO]: 'ℹ',
  [DialogType.SUCCESS]: '✓',
  [DialogType.WARNING]: '⚠',
  [DialogType.ERROR]: '✕',
};

/**
 * 함수형 dialog의 단일 mount 지점.
 * AppProviders 트리에 한 번만 배치한다.
 */
export const DialogProvider = (): ReactElement | null => {
  const config = useDialogStore((s) => s.dialogConfig);
  const {
    isOpen,
    type,
    isOverlayPressClose,
    isCancelWith,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    renderActions,
  } = config;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

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
        className={`modal app-dialog panel ${variantClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={displayTitle}
      >
        <div className="panel__title app-dialog__title">
          <span className="app-dialog__icon" aria-hidden>
            {TYPE_ICON[type]}
          </span>
          <span>{displayTitle}</span>
        </div>
        <div className="panel__body app-dialog__body">{message}</div>
        <div className="panel__body app-dialog__actions">
          {renderActions ? (
            renderActions(onCancel)
          ) : (
            <>
              {isCancelWith ? (
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
