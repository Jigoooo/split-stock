// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LogCategory } from '../model/use-log-tail';
import { LogsCategoryStatus } from './logs-category-status';

describe('LogsCategoryStatus', () => {
  it('공통 Checkbox 기반 카테고리 토글을 즉시 반영한다', () => {
    const setCategories = vi.fn();

    render(
      <LogsCategoryStatus
        categories={new Set<LogCategory>(['ORDER'])}
        setCategories={setCategories}
        statusText="상태"
      />,
    );

    const order = screen.getByRole('checkbox', { name: 'ORDER' });
    expect(order).toBeChecked();
    expect(order.closest('label')).toHaveClass('logs-category-filter__choice--active');

    fireEvent.click(screen.getByRole('checkbox', { name: 'AUTH' }));
    expect(Array.from(setCategories.mock.calls.at(-1)?.[0] as Set<LogCategory>)).toEqual([
      'ORDER',
      'AUTH',
    ]);

    fireEvent.click(order);
    expect(Array.from(setCategories.mock.calls.at(-1)?.[0] as Set<LogCategory>)).toEqual([]);
  });
});
