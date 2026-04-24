import { create } from 'zustand';

import {
  type DialogActions,
  type DialogConfig,
  DialogMode,
  type DialogOpenPayload,
  type DialogStates,
  type DialogStore,
  DialogType,
  type DialogTypePayload,
} from './dialog-types';

const noop = (): void => {};

const getInitialConfig = (): DialogConfig => ({
  isOpen: false,
  mode: DialogMode.ALERT,
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
  let pendingAsyncResolve: ((value: boolean) => void) | null = null;

  const settlePendingAsync = (value: boolean): void => {
    const resolve = pendingAsyncResolve;
    pendingAsyncResolve = null;
    resolve?.(value);
  };

  const closeAndReset = (result = false): void => {
    settlePendingAsync(result);
    setState((prev) => ({ dialogConfig: { ...prev.dialogConfig, isOpen: false } }));
    setTimeout(() => {
      // 다른 dialog가 그 사이에 열렸다면 reset 스킵
      if (!getState().dialogConfig.isOpen) {
        setState({ dialogConfig: getInitialConfig() });
      }
    }, RESET_DELAY_MS);
  };

  const buildDialogConfig = (
    payload: DialogOpenPayload,
    handlers?: {
      onConfirm?: () => void;
      onCancel?: () => void;
    },
  ): DialogConfig => {
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

    return {
      isOpen: true,
      mode: shouldShowCancel ? DialogMode.CONFIRM : DialogMode.ALERT,
      type,
      isOverlayPressClose,
      isCancelWith: shouldShowCancel,
      title: title ?? '알림',
      message,
      confirmText: confirmText ?? '확인',
      cancelText: cancelText ?? '취소',
      onConfirm: handlers?.onConfirm ?? noop,
      onCancel: handlers?.onCancel ?? noop,
      renderActions,
    };
  };

  const openDialog = (payload: DialogOpenPayload): void => {
    settlePendingAsync(false);
    const { onConfirm = noop, onCancel = noop } = payload;

    setState({
      dialogConfig: buildDialogConfig(payload, {
        onConfirm: () => {
          onConfirm();
          closeAndReset(true);
        },
        onCancel: () => {
          onCancel();
          closeAndReset(false);
        },
      }),
    });
  };

  const openDialogAsync = (payload: DialogOpenPayload): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      settlePendingAsync(false);
      pendingAsyncResolve = resolve;

      setState({
        dialogConfig: buildDialogConfig(payload, {
          onConfirm: () => {
            closeAndReset(true);
          },
          onCancel: () => {
            closeAndReset(false);
          },
        }),
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
    close: () => closeAndReset(false),
  };

  const initial: DialogStates = { dialogConfig: getInitialConfig() };
  return { ...initial, actions };
});

/** 함수형 API — 컴포넌트 바깥에서도 직접 호출 가능. */
export const dialog: DialogActions = useDialogStore.getState().actions;
