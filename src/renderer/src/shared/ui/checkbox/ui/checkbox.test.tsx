// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('checked 상태 변경을 올린다', () => {
    const onChange = vi.fn();

    render(<Checkbox aria-label="동의" checked={false} onChange={onChange} label="동의" />);

    fireEvent.click(screen.getByRole('checkbox', { name: '동의' }));

    expect(onChange).toHaveBeenCalled();
  });
});
