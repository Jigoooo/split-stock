import { create } from 'zustand';

import {
  type DialogActions,
  type DialogConfig,
  type DialogOpenPayload,
  type DialogStates,
  type DialogStore,
  DialogType,
  type DialogTypePayload,
} from './dialog-types';

const noop = (): void => {};

const getInitialConfig = (): DialogConfig => ({
  isOpen: false,
  type: DialogType.INFO,
  isOverlayPressClose: true,
  isCancelWith: false,
  title: '알림',
  message: '',
  confirmText: '확인',
  cancelText: '취소',
  onConfirm: noop,
  onCancel: noop,
  renderActions: undefined,
});

/** 닫힘 직후 잔여 state(예: renderActions, callbacks) 정리를 살짝 지연. */
const RESET_DELAY_MS = 200;

export const useDialogStore = create<DialogStore>()((setState, getState) => {
  const closeAndReset = (): void => {
    setState((prev) => ({ dialogConfig: { ...prev.dialogConfig, isOpen: false } }));
    setTimeout(() => {
      // 다른 dialog가 그 사이에 열렸다면 reset 스킵
      if (!getState().dialogConfig.isOpen) {
        setState({ dialogConfig: getInitialConfig() });
      }
    }, RESET_DELAY_MS);
  };

  const openDialog = (payload: DialogOpenPayload): void => {
    const {
      type = DialogType.INFO,
      isOverlayPressClose = true,
      isCancelWith = false,
      title,
      message,
      confirmText,
      cancelText,
      onConfirm = noop,
      onCancel = noop,
      renderActions,
    } = payload;

    const shouldShowCancel = cancelText !== undefined ? true : isCancelWith;

    setState({
      dialogConfig: {
        isOpen: true,
        type,
        isOverlayPressClose,
        isCancelWith: shouldShowCancel,
        title: title ?? '알림',
        message,
        confirmText: confirmText ?? '확인',
        cancelText: cancelText ?? '취소',
        onConfirm: () => {
          onConfirm();
          closeAndReset();
        },
        onCancel: () => {
          onCancel();
          closeAndReset();
        },
        renderActions,
      },
    });
  };

  const openDialogAsync = (payload: DialogOpenPayload): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const {
        type = DialogType.INFO,
        isOverlayPressClose = true,
        isCancelWith = false,
        title,
        message,
        confirmText,
        cancelText,
        renderActions,
      } = payload;

      const shouldShowCancel = cancelText !== undefined ? true : isCancelWith;

      setState({
        dialogConfig: {
          isOpen: true,
          type,
          isOverlayPressClose,
          isCancelWith: shouldShowCancel,
          title: title ?? '알림',
          message,
          confirmText: confirmText ?? '확인',
          cancelText: cancelText ?? '취소',
          onConfirm: () => {
            resolve(true);
            closeAndReset();
          },
          onCancel: () => {
            resolve(false);
            closeAndReset();
          },
          renderActions,
        },
      });
    });
  };

  const actions: DialogActions = {
    open: openDialog,
    openAsync: openDialogAsync,
    success: (p: DialogTypePayload) => openDialog({ ...p, type: DialogType.SUCCESS }),
    successAsync: (p: DialogTypePayload) => openDialogAsync({ ...p, type: DialogType.SUCCESS }),
    warning: (p: DialogTypePayload) => openDialog({ ...p, type: DialogType.WARNING }),
    warningAsync: (p: DialogTypePayload) => openDialogAsync({ ...p, type: DialogType.WARNING }),
    error: (p: DialogTypePayload) => openDialog({ ...p, type: DialogType.ERROR }),
    errorAsync: (p: DialogTypePayload) => openDialogAsync({ ...p, type: DialogType.ERROR }),
    info: (p: DialogTypePayload) => openDialog({ ...p, type: DialogType.INFO }),
    infoAsync: (p: DialogTypePayload) => openDialogAsync({ ...p, type: DialogType.INFO }),
    close: closeAndReset,
  };

  const initial: DialogStates = { dialogConfig: getInitialConfig() };
  return { ...initial, actions };
});

/** 함수형 API — 컴포넌트 바깥에서도 직접 호출 가능. */
export const dialog: DialogActions = useDialogStore.getState().actions;
