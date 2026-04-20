// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrawingToolbar } from './drawing-toolbar';

describe('DrawingToolbar', () => {
  it('각 도구 버튼과 삭제 액션을 전달한 핸들러에 연결한다', () => {
    const onStartDraw = vi.fn();
    const onRemoveLast = vi.fn();
    const onRemoveAll = vi.fn();

    render(
      <DrawingToolbar
        activeTool="TrendLine"
        onStartDraw={onStartDraw}
        onRemoveLast={onRemoveLast}
        onRemoveAll={onRemoveAll}
      />,
    );

    expect(screen.getByRole('toolbar', { name: '드로잉 도구' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '추세선' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '수평선' }));
    fireEvent.click(screen.getByRole('button', { name: '수직선' }));
    fireEvent.click(screen.getByRole('button', { name: '박스' }));
    fireEvent.click(screen.getByRole('button', { name: '마지막 되돌리기' }));
    fireEvent.click(screen.getByRole('button', { name: '전체 삭제' }));

    expect(onStartDraw).toHaveBeenNthCalledWith(1, 'HorizontalLine');
    expect(onStartDraw).toHaveBeenNthCalledWith(2, 'VerticalLine');
    expect(onStartDraw).toHaveBeenNthCalledWith(3, 'Rectangle');
    expect(onRemoveLast).toHaveBeenCalledTimes(1);
    expect(onRemoveAll).toHaveBeenCalledTimes(1);
  });
});
