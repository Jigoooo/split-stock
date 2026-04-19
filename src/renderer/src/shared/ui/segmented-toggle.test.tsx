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

    const activeTab = screen.getByRole('tab', { name: '실시간 체결' });
    const inactiveTab = screen.getByRole('tab', { name: '미체결 주문' });
    const classNameBeforeHover = activeTab.className;

    expect(activeTab).toHaveClass('hts-segmented__item--active');

    fireEvent.mouseOver(activeTab);
    expect(activeTab.className).toBe(classNameBeforeHover);

    fireEvent.click(inactiveTab);
    expect(onChange).toHaveBeenCalledWith('active');
  });
});
