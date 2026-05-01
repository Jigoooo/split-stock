// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const toggleMock = vi.fn();
const useActiveOrdersMock = vi.fn(() => ({
  cancelError: null,
  cancelPending: false,
  cancelSelected: vi.fn(),
  orders: [
    {
      odno: 'ODN-1',
      pdno: '005930',
      side: 'BUY',
      division: 'LIMIT',
      qty: 10,
      filledQty: 0,
      remainingQty: 10,
      price: 70000,
      status: 'PENDING',
      placedAt: new Date('2026-04-20T10:00:00+09:00').toISOString(),
    },
  ],
  selected: new Set<string>(['ODN-1']),
  toggle: toggleMock,
}));

vi.mock('../model/use-active-orders', () => ({
  useActiveOrders: () => useActiveOrdersMock(),
}));

import { ActiveOrdersPanel } from './active-orders-panel';

describe('ActiveOrdersPanel', () => {
  it('체크박스 클릭이 기존 toggle 흐름을 유지한다', () => {
    render(<ActiveOrdersPanel pdnoFilter="005930" />);

    fireEvent.click(screen.getByRole('checkbox', { name: '선택 ODN-1' }));

    expect(toggleMock).toHaveBeenCalledWith('ODN-1');
  });

  it('부분체결 주문은 남은 수량과 체결 수량을 함께 표시한다', () => {
    useActiveOrdersMock.mockReturnValueOnce({
      cancelError: null,
      cancelPending: false,
      cancelSelected: vi.fn(),
      orders: [
        {
          odno: 'ODN-2',
          pdno: '005930',
          side: 'BUY',
          division: 'LIMIT',
          qty: 10,
          filledQty: 3,
          remainingQty: 7,
          price: 70000,
          status: 'PARTIAL',
          placedAt: new Date('2026-04-20T10:00:00+09:00').toISOString(),
        },
      ],
      selected: new Set<string>(),
      toggle: vi.fn(),
    });

    render(<ActiveOrdersPanel pdnoFilter="005930" nameFilter="삼성전자" />);

    expect(screen.getByText('7 / 10')).toBeInTheDocument();
    expect(screen.getByText('체결 3주')).toBeInTheDocument();
    expect(screen.getByText('부분체결')).toBeInTheDocument();
  });

  it('좁은 패널에서도 컬럼 최소 너비를 유지하도록 가로 스크롤 래퍼를 렌더링한다', () => {
    render(<ActiveOrdersPanel pdnoFilter="005930" />);

    const region = screen.getByRole('region', { name: '미체결 주문' });
    const headerCells = region.querySelectorAll('.table-grid-header .table-grid-cell');

    expect(region.querySelector('.table-grid-hscroll-wrapper')).toBeInTheDocument();
    expect(headerCells).toHaveLength(7);
    expect(headerCells[1]).toHaveStyle({ minWidth: '11rem' });
    expect(headerCells[3]).toHaveStyle({ minWidth: '14.8rem' });
    expect(headerCells[6]).toHaveStyle({ minWidth: '11.2rem' });
  });
});
