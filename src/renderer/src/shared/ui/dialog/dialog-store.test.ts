import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogStore } from './model/dialog-store';
import { DialogType } from './model/dialog-types';

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
  });

  it('open의 onConfirm 콜백은 호출 후 자동 close된다', () => {
    const spy = vi.fn();
    useDialogStore.getState().actions.open({ message: 'm', onConfirm: spy });
    useDialogStore.getState().dialogConfig.onConfirm();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useDialogStore.getState().dialogConfig.isOpen).toBe(false);
  });
});
