// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDrawingToolStorageKey, useDrawingTools } from './use-drawing-tools';

const { afterEditHandlerRef, createLineToolsPluginMock, lineToolsPluginMock } = vi.hoisted(() => {
  const afterEditHandlerRef: {
    current: ((...args: unknown[]) => void) | null;
  } = { current: null };

  const lineToolsPluginMock = {
    addLineTool: vi.fn(() => 'tool-1'),
    exportLineTools: vi.fn(() => '[]'),
    getSelectedLineTools: vi.fn(() => '[]'),
    importLineTools: vi.fn(() => true),
    registerLineTool: vi.fn(),
    removeAllLineTools: vi.fn(),
    removeSelectedLineTools: vi.fn(),
    subscribeLineToolsAfterEdit: vi.fn((handler: (...args: unknown[]) => void) => {
      afterEditHandlerRef.current = handler;
    }),
    unsubscribeLineToolsAfterEdit: vi.fn(),
  };

  return {
    afterEditHandlerRef,
    createLineToolsPluginMock: vi.fn(() => lineToolsPluginMock),
    lineToolsPluginMock,
  };
});

vi.mock('lightweight-charts-line-tools-core', () => ({
  createLineToolsPlugin: createLineToolsPluginMock,
}));

vi.mock('lightweight-charts-line-tools-lines', () => ({
  LineToolHorizontalLine: class {},
  LineToolTrendLine: class {},
  LineToolVerticalLine: class {},
}));

vi.mock('lightweight-charts-line-tools-rectangle', () => ({
  LineToolRectangle: class {},
}));

describe('useDrawingTools', () => {
  beforeEach(() => {
    window.localStorage.clear();
    afterEditHandlerRef.current = null;
    createLineToolsPluginMock.mockClear();
    lineToolsPluginMock.addLineTool.mockClear();
    lineToolsPluginMock.exportLineTools.mockReset();
    lineToolsPluginMock.exportLineTools.mockReturnValue('[]');
    lineToolsPluginMock.getSelectedLineTools.mockReset();
    lineToolsPluginMock.getSelectedLineTools.mockReturnValue('[]');
    lineToolsPluginMock.importLineTools.mockClear();
    lineToolsPluginMock.registerLineTool.mockClear();
    lineToolsPluginMock.removeAllLineTools.mockClear();
    lineToolsPluginMock.removeSelectedLineTools.mockClear();
    lineToolsPluginMock.subscribeLineToolsAfterEdit.mockClear();
    lineToolsPluginMock.unsubscribeLineToolsAfterEdit.mockClear();
  });

  it('host 연결 시 저장된 드로잉을 복원하고 disconnect 시 현재 상태를 저장한다', async () => {
    window.localStorage.setItem(getDrawingToolStorageKey('005930'), '[{"id":"old"}]');

    const { result } = renderHook(({ pdno }) => useDrawingTools(pdno), {
      initialProps: { pdno: '005930' },
    });

    act(() => {
      result.current.connectHost({} as never, {} as never);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(createLineToolsPluginMock).toHaveBeenCalledTimes(1);
    expect(lineToolsPluginMock.registerLineTool).toHaveBeenCalledTimes(4);
    expect(lineToolsPluginMock.importLineTools).toHaveBeenCalledWith('[{"id":"old"}]');

    lineToolsPluginMock.exportLineTools.mockReturnValue('[{"id":"persisted"}]');

    act(() => {
      result.current.disconnectHost();
    });

    expect(window.localStorage.getItem(getDrawingToolStorageKey('005930'))).toBe(
      '[{"id":"persisted"}]',
    );
    expect(lineToolsPluginMock.unsubscribeLineToolsAfterEdit).toHaveBeenCalledTimes(1);
    expect(result.current.isReady).toBe(false);
  });

  it('편집 완료 후 현재 종목 키로 즉시 저장하고 활성 도구 상태를 해제한다', async () => {
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost({} as never, {} as never);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => {
      result.current.startDraw('TrendLine');
    });

    expect(lineToolsPluginMock.addLineTool).toHaveBeenCalledWith('TrendLine', []);
    expect(result.current.activeTool).toBe('TrendLine');

    lineToolsPluginMock.exportLineTools.mockReturnValue('[{"id":"saved"}]');

    act(() => {
      afterEditHandlerRef.current?.({ stage: 'lineToolFinished' });
    });

    expect(window.localStorage.getItem(getDrawingToolStorageKey('005930'))).toBe(
      '[{"id":"saved"}]',
    );
    expect(result.current.activeTool).toBeNull();
  });

  it('removeAll 은 플러그인 native 를 호출하고 localStorage 를 빈 상태로 정리한다', async () => {
    window.localStorage.setItem(getDrawingToolStorageKey('005930'), '[{"id":"legacy"}]');
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost({} as never, {} as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => {
      result.current.removeAll();
    });

    expect(lineToolsPluginMock.removeAllLineTools).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(getDrawingToolStorageKey('005930'))).toBeNull();
    expect(result.current.activeTool).toBeNull();
  });

  it('removeSelected 는 플러그인 native 호출 후 남은 상태를 즉시 저장한다', async () => {
    const { result } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost({} as never, {} as never);
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    lineToolsPluginMock.exportLineTools.mockReturnValueOnce('[{"id":"kept"}]');

    act(() => {
      result.current.removeSelected();
    });

    expect(lineToolsPluginMock.removeSelectedLineTools).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(getDrawingToolStorageKey('005930'))).toBe('[{"id":"kept"}]');
  });

  it('unmount 시 현재 드로잉 상태를 저장한다', async () => {
    const { result, unmount } = renderHook(() => useDrawingTools('005930'));

    act(() => {
      result.current.connectHost({} as never, {} as never);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    lineToolsPluginMock.exportLineTools.mockReturnValue('[{"id":"unmounted"}]');

    unmount();

    expect(window.localStorage.getItem(getDrawingToolStorageKey('005930'))).toBe(
      '[{"id":"unmounted"}]',
    );
  });
});
