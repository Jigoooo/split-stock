// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const createWatchOrder = vi.fn();
const cancelWatchOrder = vi.fn();
const invalidateWatchList = vi.fn();
const updateWatchOrder = vi.fn();
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      bottom: 52,
      height: 32,
      left: 24,
      right: 240,
      toJSON: () => ({}),
      top: 20,
      width: 216,
      x: 24,
      y: 20,
    };
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      watch: {
        list: {
          invalidate: invalidateWatchList,
        },
      },
    }),
    watch: {
      cancel: {
        useMutation: () => ({
          mutateAsync: cancelWatchOrder,
          isPending: false,
        }),
      },
      create: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: createWatchOrder,
        }),
      },
      update: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: updateWatchOrder,
        }),
      },
    },
  },
}));

vi.mock('@renderer/entities/stock', () => ({
  StockPickerList: () => <div data-testid="stock-picker-list" />,
}));

import { AddWatchOrderDialog } from './add-watch-order-dialog';

describe('AddWatchOrderDialog', () => {
  it('만료일 직접 입력 정규화 후 달력 선택으로 다시 변경하고 저장한다', async () => {
    createWatchOrder.mockReset();
    cancelWatchOrder.mockReset();
    invalidateWatchList.mockReset();
    updateWatchOrder.mockReset();
    createWatchOrder.mockResolvedValue({ order: { id: 1 } });
    invalidateWatchList.mockResolvedValue(undefined);

    render(
      <AddWatchOrderDialog
        accountId={1}
        open={true}
        onClose={vi.fn()}
        prefill={{
          amountKrw: 1000000,
          orderType: 'LIMIT',
          pdName: '삼성전자',
          pdno: '005930',
          qtyOrAmountMode: 'AMOUNT',
          targetPrice: 70000,
        }}
      />,
    );

    const yearInput = screen.getByLabelText('유효일 연도');
    const monthInput = screen.getByLabelText('유효일 월');
    const dayInput = screen.getByLabelText('유효일 일');
    fireEvent.change(yearInput, { target: { value: '2099' } });
    fireEvent.change(monthInput, { target: { value: '2' } });
    fireEvent.change(dayInput, { target: { value: '31' } });
    fireEvent.blur(dayInput);

    await waitFor(() => {
      expect(yearInput).toHaveValue('2099');
      expect(monthInput).toHaveValue('02');
      expect(dayInput).toHaveValue('28');
    });

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '월 선택 열기' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '월 선택 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '6월 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '2099-06-18 선택' }));

    await waitFor(() => {
      expect(yearInput).toHaveValue('2099');
      expect(monthInput).toHaveValue('06');
      expect(dayInput).toHaveValue('18');
    });

    fireEvent.click(screen.getByRole('button', { name: '추가' }));

    await waitFor(() => {
      expect(createWatchOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 1,
          amountKrw: 1000000,
          expiresAt: Date.parse('2099-06-18T23:59:59'),
          orderType: 'LIMIT',
          pdno: '005930',
          qtyOrAmountMode: 'AMOUNT',
          targetPrice: 70000,
        }),
      );
    });
  });
});
