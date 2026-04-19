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
      price: 70000,
      status: 'OPEN',
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
});
