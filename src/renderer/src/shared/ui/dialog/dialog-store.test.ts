import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertDialog } from './lib/alert-dialog';
import { useDialogStore } from './model/dialog-store';
import { DialogMode, DialogType } from './model/dialog-types';

const reset = (): void => {
  useDialogStore.getState().actions.close();
  // RESET_DELAY_MS 만큼 대기는 fake timer로 처리
};

describe('dialog-store', () => {
  afterEach(() => {
    // 직접 state 초기화 (close의 setTimeout이 테스트 누수 방지)
    useDialogStore.setState({
      dialogConfig: {
        isOpen: false,
        mode: DialogMode.ALERT,
        type: DialogType.INFO,
        isOverlayPressClose: true,
        isCancelWith: false,
        title: '알림',
        message: '',
        confirmText: '확인',
        cancelText: '취소',
        onConfirm: () => {},
        onCancel: () => {},
        renderActions: undefined,
      },
    });
    vi.useRealTimers();
  });

  it('open이 isOpen=true와 message를 set한다', () => {
    useDialogStore.getState().actions.open({ message: '테스트 메시지' });
    const cfg = useDialogStore.getState().dialogConfig;
    expect(cfg.isOpen).toBe(true);
    expect(cfg.message).toBe('테스트 메시지');
    expect(cfg.type).toBe(DialogType.INFO);
    expect(cfg.mode).toBe(DialogMode.ALERT);
  });

  it('close가 isOpen=false로 만든다', () => {
    useDialogStore.getState().actions.open({ message: 'm' });
    expect(useDialogStore.getState().dialogConfig.isOpen).toBe(true);
    reset();
    expect(useDialogStore.getState().dialogConfig.isOpen).toBe(false);
  });

  it('success/warning/error/info 헬퍼는 type 필드를 강제한다', () => {
    const { actions } = useDialogStore.getState();
    actions.success({ message: 's' });
    expect(useDialogStore.getState().dialogConfig.type).toBe(DialogType.SUCCESS);
    actions.warning({ message: 'w' });
    expect(useDialogStore.getState().dialogConfig.type).toBe(DialogType.WARNING);
    actions.error({ message: 'e' });
    expect(useDialogStore.getState().dialogConfig.type).toBe(DialogType.ERROR);
    actions.info({ message: 'i' });
    expect(useDialogStore.getState().dialogConfig.type).toBe(DialogType.INFO);
  });

  it('openAsync — onConfirm 호출 시 true로 resolve', async () => {
    const promise = useDialogStore.getState().actions.openAsync({ message: 'q' });
    useDialogStore.getState().dialogConfig.onConfirm();
    await expect(promise).resolves.toBe(true);
  });

  it('openAsync — onCancel 호출 시 false로 resolve', async () => {
    const promise = useDialogStore.getState().actions.openAsync({ message: 'q' });
    useDialogStore.getState().dialogConfig.onCancel();
    await expect(promise).resolves.toBe(false);
  });

  it('warningAsync는 type=WARNING으로 열린다', async () => {
    const promise = useDialogStore.getState().actions.warningAsync({ message: 'w' });
    expect(useDialogStore.getState().dialogConfig.type).toBe(DialogType.WARNING);
    expect(useDialogStore.getState().dialogConfig.mode).toBe(DialogMode.ALERT);
    useDialogStore.getState().dialogConfig.onCancel();
    await expect(promise).resolves.toBe(false);
  });

  it('cancelText 지정 시 isCancelWith가 자동으로 true', () => {
    useDialogStore.getState().actions.open({ message: 'x', cancelText: '닫기' });
    expect(useDialogStore.getState().dialogConfig.isCancelWith).toBe(true);
    expect(useDialogStore.getState().dialogConfig.cancelText).toBe('닫기');
  });

  it('isCancelWith=true 명시도 cancel 버튼 노출 정보를 유지한다', () => {
    useDialogStore.getState().actions.open({ message: 'x', isCancelWith: true });
    expect(useDialogStore.getState().dialogConfig.isCancelWith).toBe(true);
    expect(useDialogStore.getState().dialogConfig.mode).toBe(DialogMode.CONFIRM);
  });

  it('open의 onConfirm 콜백은 호출 후 자동 close된다', () => {
    const spy = vi.fn();
    useDialogStore.getState().actions.open({ message: 'm', onConfirm: spy });
    useDialogStore.getState().dialogConfig.onConfirm();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useDialogStore.getState().dialogConfig.isOpen).toBe(false);
  });

  it('alertDialog.confirm은 기본적으로 warning confirm dialog를 연다', async () => {
    const promise = alertDialog.confirm({ message: '정말 진행할까요?' });
    const config = useDialogStore.getState().dialogConfig;

    expect(config.type).toBe(DialogType.WARNING);
    expect(config.mode).toBe(DialogMode.CONFIRM);

    config.onCancel();
    await expect(promise).resolves.toBe(false);
  });

  it('두 번째 async dialog가 열리면 이전 pending promise를 false로 resolve한다', async () => {
    const first = useDialogStore.getState().actions.openAsync({ message: 'first' });
    const second = useDialogStore.getState().actions.openAsync({ message: 'second' });

    await expect(first).resolves.toBe(false);

    useDialogStore.getState().dialogConfig.onConfirm();
    await expect(second).resolves.toBe(true);
  });

  it('alertDialog.alert는 기본적으로 info alert mode로 열린다', async () => {
    const promise = alertDialog.alert({ message: '확인만 필요합니다' });
    const config = useDialogStore.getState().dialogConfig;

    expect(config.type).toBe(DialogType.INFO);
    expect(config.mode).toBe(DialogMode.ALERT);

    config.onConfirm();
    await expect(promise).resolves.toBe(true);
  });
});
