// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Mock trpc module BEFORE importing the component-under-test.
const searchMock = vi.fn();

vi.mock('@renderer/shared/api/trpc', () => {
  return {
    trpc: {
      market: {
        searchStock: {
          useQuery: (input: { term: string; limit: number }, opts?: { enabled?: boolean }) => {
            if (opts?.enabled === false) {
              return { data: undefined, isLoading: false, error: null };
            }
            const data = searchMock(input);
            return { data, isLoading: false, error: null };
          },
        },
      },
    },
  };
});

import { SearchStockInput } from './search-stock-input';

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient();
  const Provider = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return <Provider>{ui}</Provider>;
}

describe('SearchStockInput', () => {
  it('빈 입력: 드롭다운 미표시', () => {
    render(wrap(<SearchStockInput onSelect={vi.fn()} />));
    fireEvent.focus(screen.getByRole('combobox', { name: '종목 검색 입력' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('디바운스: 빠른 입력 중에는 searchMock 호출 없음, 완료 후 1번', async () => {
    searchMock.mockReturnValue({ entries: [{ pdno: '005930', name: '삼성전자', sector: null }] });
    searchMock.mockClear();

    render(wrap(<SearchStockInput onSelect={vi.fn()} />));
    const input = screen.getByRole('combobox', { name: '종목 검색 입력' });
    fireEvent.focus(input);
    // 연속 입력 3회
    fireEvent.change(input, { target: { value: '삼' } });
    fireEvent.change(input, { target: { value: '삼성' } });
    fireEvent.change(input, { target: { value: '삼성전자' } });

    // debounce 미완료 → 즉시 호출 없어야 함
    expect(searchMock).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(searchMock).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );
    expect(searchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const lastCall = searchMock.mock.calls[searchMock.mock.calls.length - 1]?.[0];
    expect(lastCall?.term).toBe('삼성전자');
  });

  it('결과 렌더 + 마우스 클릭 시 onSelect 호출', async () => {
    searchMock.mockReturnValue({
      entries: [
        { pdno: '005930', name: '삼성전자', sector: '반도체' },
        { pdno: '000660', name: 'SK하이닉스', sector: '반도체' },
      ],
    });
    const onSelect = vi.fn();
    render(wrap(<SearchStockInput onSelect={onSelect} />));
    const input = screen.getByRole('combobox', { name: '종목 검색 입력' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '삼성' } });

    const options = await screen.findAllByRole('option', undefined, { timeout: 2000 });
    expect(options).toHaveLength(2);
    fireEvent.mouseDown(options[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith({
      pdno: '005930',
      name: '삼성전자',
      sector: '반도체',
    });
  });

  it('키보드 ArrowDown + Enter → onSelect', async () => {
    searchMock.mockReturnValue({
      entries: [
        { pdno: '005930', name: '삼성전자', sector: null },
        { pdno: '000660', name: 'SK하이닉스', sector: null },
      ],
    });
    const onSelect = vi.fn();
    render(wrap(<SearchStockInput onSelect={onSelect} />));
    const input = screen.getByRole('combobox', { name: '종목 검색 입력' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '하이' } });

    // 옵션이 렌더된 후에 keyboard nav 테스트
    await screen.findAllByRole('option', undefined, { timeout: 2000 });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({
      pdno: '000660',
      name: 'SK하이닉스',
      sector: null,
    });
  });

  it('결과 0건: "결과 없음" 표시', async () => {
    searchMock.mockReturnValue({ entries: [] });
    render(wrap(<SearchStockInput onSelect={vi.fn()} />));
    const input = screen.getByRole('combobox', { name: '종목 검색 입력' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '존재없' } });

    await screen.findByText('결과 없음', undefined, { timeout: 2000 });
  });

  it('Escape 입력 시 목록을 닫는다', async () => {
    searchMock.mockReturnValue({
      entries: [{ pdno: '005930', name: '삼성전자', sector: null }],
    });
    render(wrap(<SearchStockInput onSelect={vi.fn()} />));
    const input = screen.getByRole('combobox', { name: '종목 검색 입력' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '삼성' } });

    await screen.findByRole('listbox', undefined, { timeout: 2000 });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
});
