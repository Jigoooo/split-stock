// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput } from './number-input';

describe('NumberInput', () => {
  it('표시는 콤마를 넣고 변경 콜백에는 raw 값을 넘긴다', () => {
    const onValueChange = vi.fn();

    render(<NumberInput value="12345" onValueChange={onValueChange} aria-label="수량" />);

    const input = screen.getByLabelText('수량');
    expect(input).toHaveValue('12,345');

    fireEvent.change(input, { target: { value: '12,3456' } });

    expect(onValueChange).toHaveBeenCalledWith('123456');
  });

  it('disabled + emptyDisplay면 대체 문구를 보여준다', () => {
    render(
      <NumberInput
        value=""
        onValueChange={vi.fn()}
        aria-label="가격"
        disabled
        emptyDisplay="시장가"
      />,
    );

    expect(screen.getByLabelText('가격')).toHaveValue('시장가');
  });

  it('spinner mode에서 입력 필드 ArrowUp/ArrowDown으로 값을 증감한다', () => {
    const onValueChange = vi.fn();
    render(
      <NumberInput
        value="10"
        onValueChange={onValueChange}
        aria-label="수량"
        showSpinner
        step={5}
        min={0}
      />,
    );

    const input = screen.getByLabelText('수량');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(onValueChange).toHaveBeenNthCalledWith(1, '15');
    expect(onValueChange).toHaveBeenNthCalledWith(2, '5');
  });
});
