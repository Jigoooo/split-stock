// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LogsToolbar } from './logs-toolbar';

function renderToolbar(overrides: Partial<Parameters<typeof LogsToolbar>[0]> = {}) {
  const props = {
    dateRange: '' as const,
    entriesCount: 12,
    exportDisabled: false,
    exportPending: false,
    level: '' as const,
    onExport: vi.fn(),
    search: '',
    setDateRange: vi.fn(),
    setLevel: vi.fn(),
    setSearch: vi.fn(),
    setStream: vi.fn(),
    setViewMode: vi.fn(),
    stream: '' as const,
    viewMode: 'list' as const,
    ...overrides,
  };

  render(<LogsToolbar {...props} />);
  return props;
}

describe('LogsToolbar', () => {
  it('검색 input은 즉시 setSearch를 호출하고 clear 버튼을 제공한다', () => {
    const props = renderToolbar({ search: 'order' });

    fireEvent.change(screen.getByLabelText('검색'), { target: { value: '005930' } });
    expect(props.setSearch).toHaveBeenCalledWith('005930');

    fireEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(props.setSearch).toHaveBeenCalledWith('');
  });

  it('셀렉트 변경을 transition 없이 즉시 전달한다', () => {
    const props = renderToolbar();

    fireEvent.click(screen.getByLabelText('레벨'));
    const errorOption = screen.getByText('ERROR').closest('[role="option"]');
    expect(errorOption).not.toBeNull();
    fireEvent.click(errorOption as HTMLElement);

    expect(props.setLevel).toHaveBeenCalledWith('ERROR');
  });

  it('필터 반영 중에는 export 버튼을 비활성화한다', () => {
    renderToolbar({ exportDisabled: true });

    expect(screen.getByRole('button', { name: 'CSV 저장' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'JSON 저장' })).toBeDisabled();
  });

  it('목록/실시간 보기 전환 segmented control을 제공한다', () => {
    const props = renderToolbar();

    expect(screen.getByRole('radio', { name: '목록' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '실시간' }));

    expect(props.setViewMode).toHaveBeenCalledWith('live');
  });
});
