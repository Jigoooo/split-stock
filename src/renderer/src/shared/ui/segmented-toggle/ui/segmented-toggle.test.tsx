// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedToggle } from './segmented-toggle';

describe('SegmentedToggle', () => {
  it('active 상태를 유지하고 값 변경을 올린다', () => {
    const onChange = vi.fn();

    render(
      <SegmentedToggle
        value="feed"
        onChange={onChange}
        ariaLabel="체결/미체결"
        items={[
          { value: 'feed', label: '실시간 체결' },
          { value: 'active', label: '미체결 주문' },
        ]}
      />,
    );

    const activeRadio = screen.getByRole('radio', { name: '실시간 체결' });
    const inactiveRadio = screen.getByRole('radio', { name: '미체결 주문' });
    const classNameBeforeHover = activeRadio.className;

    expect(activeRadio).toHaveAttribute('aria-checked', 'true');
    expect(activeRadio).toHaveClass('hts-segmented__item--active');

    fireEvent.mouseOver(activeRadio);
    expect(activeRadio.className).toBe(classNameBeforeHover);

    fireEvent.click(inactiveRadio);
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('arrow keys move through the radio-style options', () => {
    const onChange = vi.fn();

    render(
      <SegmentedToggle
        value="feed"
        onChange={onChange}
        ariaLabel="체결/미체결"
        items={[
          { value: 'feed', label: '실시간 체결' },
          { value: 'active', label: '미체결 주문' },
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: '실시간 체결' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('active');
  });
});
