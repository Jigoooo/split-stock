import type { ReactNode } from 'react';

/**
 * 함수형 dialog 시스템 — modal(ALERT) 단일 presentation.
 * 향후 SHEET 등 추가 가능.
 */
export const DialogType = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
} as const;

export type DialogTypeValue = (typeof DialogType)[keyof typeof DialogType];

export const DialogMode = {
  ALERT: 'ALERT',
  CONFIRM: 'CONFIRM',
} as const;

export type DialogModeValue = (typeof DialogMode)[keyof typeof DialogMode];

export type DialogActionsRenderer = (close: () => void) => ReactNode;

export interface DialogConfig {
  isOpen: boolean;
  mode: DialogModeValue;
  type: DialogTypeValue;
  isOverlayPressClose: boolean;
  isCancelWith: boolean;
  title: string;
  message: ReactNode;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  renderActions: DialogActionsRenderer | undefined;
  accentColor?: string;
}

export interface DialogOpenPayload {
  type?: DialogTypeValue;
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  isCancelWith?: boolean;
  isOverlayPressClose?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  renderActions?: DialogActionsRenderer;
  accentColor?: string;
}

/** type별 헬퍼는 type 필드를 강제하지 않음 (helper가 주입). */
export type DialogTypePayload = Omit<DialogOpenPayload, 'type'>;

export interface DialogStates {
  dialogConfig: DialogConfig;
}

export interface DialogActions {
  open: (payload: DialogOpenPayload) => void;
  openAsync: (payload: DialogOpenPayload) => Promise<boolean>;
  success: (payload: DialogTypePayload) => void;
  successAsync: (payload: DialogTypePayload) => Promise<boolean>;
  warning: (payload: DialogTypePayload) => void;
  warningAsync: (payload: DialogTypePayload) => Promise<boolean>;
  error: (payload: DialogTypePayload) => void;
  errorAsync: (payload: DialogTypePayload) => Promise<boolean>;
  info: (payload: DialogTypePayload) => void;
  infoAsync: (payload: DialogTypePayload) => Promise<boolean>;
  close: () => void;
}

export interface DialogStore extends DialogStates {
  actions: DialogActions;
}
