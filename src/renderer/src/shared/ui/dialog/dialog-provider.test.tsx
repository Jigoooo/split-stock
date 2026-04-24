// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStackStore } from '../overlay-stack';
import { useDialogStore } from './model/dialog-store';
import { DialogMode, DialogType } from './model/dialog-types';
import { DialogProvider } from './ui/dialog-provider';

const resetDialogStore = (): void => {
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
      onConfirm: () => undefined,
      onCancel: () => undefined,
      renderActions: undefined,
    },
  });
};

describe('DialogProvider', () => {
  afterEach(() => {
    resetDialogStore();
    useOverlayStackStore.setState({
      pendingBacks: 0,
      stack: [],
    });
  });

  it('ReactNode message를 portal로 렌더한다', async () => {
    render(<DialogProvider />);

    act(() => {
      useDialogStore.getState().actions.open({
        title: '안내',
        message: (
          <div>
            <strong>삭제 경고</strong>
          </div>
        ),
      });
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('삭제 경고')).toBeInTheDocument();
  });

  it('renderActions를 그대로 사용하고 close 콜백을 전달한다', async () => {
    render(<DialogProvider />);

    const actionSpy = vi.fn();
    act(() => {
      useDialogStore.getState().actions.open({
        message: '커스텀 액션',
        renderActions: (close) => (
          <button
            type="button"
            onClick={() => {
              actionSpy();
              close();
            }}
          >
            직접 닫기
          </button>
        ),
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: '직접 닫기' }));

    await waitFor(() => {
      expect(actionSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('isOverlayPressClose=false 이면 Escape와 backdrop close를 막는다', async () => {
    render(<DialogProvider />);

    act(() => {
      useDialogStore.getState().actions.open({
        message: '보호된 다이얼로그',
        isOverlayPressClose: false,
        isCancelWith: true,
      });
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('isOverlayPressClose=true 이면 backdrop click으로 닫힌다', async () => {
    render(<DialogProvider />);

    act(() => {
      useDialogStore.getState().actions.open({
        message: 'backdrop close',
        isOverlayPressClose: true,
      });
    });

    const dialog = await screen.findByRole('dialog');
    const backdrop = dialog.previousElementSibling;
    expect(backdrop).toBeInstanceOf(HTMLElement);

    fireEvent.click(backdrop as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('dialog.close는 cancel 콜백 없이 닫는다', async () => {
    const onCancel = vi.fn();
    render(<DialogProvider />);

    act(() => {
      useDialogStore.getState().actions.open({
        message: 'programmatic close',
        onCancel,
      });
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => {
      useDialogStore.getState().actions.close();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
