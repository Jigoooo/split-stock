// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const syncMutateMock = vi.fn();
const refetchMock = vi.fn();
const entriesMock = [
  { pdno: '005930', name: '삼성전자', sector: 'KOSPI' },
  { pdno: '000660', name: 'SK하이닉스', sector: 'KOSPI' },
];

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    market: {
      listAllStock: {
        useQuery: () => ({
          data: { entries: entriesMock },
          isLoading: false,
          error: null,
        }),
      },
      getStockMasterStatus: {
        useQuery: () => ({
          data: { total: entriesMock.length },
          isLoading: false,
          refetch: refetchMock,
        }),
      },
      syncStockMaster: {
        useMutation: () => ({
          isPending: false,
          error: null,
          mutate: syncMutateMock,
        }),
      },
    },
    useUtils: () => ({
      market: {
        listAllStock: {
          invalidate: vi.fn(),
        },
      },
    }),
  },
}));

import { StockPickerList } from './stock-picker-list';

describe('StockPickerList', () => {
  it('폼 임베드 모드에서는 동기화/팝아웃 버튼을 숨길 수 있다', () => {
    render(<StockPickerList onSelect={vi.fn()} hideSyncButton hidePopoutButton />);

    expect(screen.queryByRole('button', { name: '종목 마스터 재동기화' })).toBeNull();
    expect(screen.queryByRole('button', { name: '종목 선택 팝아웃 창' })).toBeNull();
  });

  it('검색 후 결과 선택 시 entry 전체를 onSelect로 전달한다', async () => {
    const onSelect = vi.fn();
    render(<StockPickerList onSelect={onSelect} hideSyncButton hidePopoutButton />);

    const input = screen.getByRole('textbox', { name: '종목 검색' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '삼성' } });

    const option = await screen.findByText('005930');
    fireEvent.mouseDown(option.closest('[role="option"]') as HTMLElement);

    expect(onSelect).toHaveBeenCalledWith({
      pdno: '005930',
      name: '삼성전자',
      sector: 'KOSPI',
    });
  });

  it('한글 IME 조합 중 Enter 선택 후 뒤늦은 마지막 글자 change 이벤트가 와도 input이 비워진다', () => {
    const onSelect = vi.fn();
    render(<StockPickerList onSelect={onSelect} hideSyncButton hidePopoutButton />);

    const input = screen.getByRole('textbox', { name: '종목 검색' });
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '삼성' } });

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { data: '성' });
    fireEvent.change(input, { target: { value: '성' } });

    expect(onSelect).toHaveBeenCalledWith({
      pdno: '005930',
      name: '삼성전자',
      sector: 'KOSPI',
    });
    expect(input).toHaveValue('');
  });

  it('maxVisible 만큼만 표시하고 나머지는 요약한다', async () => {
    render(<StockPickerList onSelect={vi.fn()} hideSyncButton hidePopoutButton maxVisible={1} />);

    const input = screen.getByRole('textbox', { name: '종목 검색' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(screen.getByText(/상위 1건 표시 중 · 전체 2건/)).toBeInTheDocument();
  });
});
