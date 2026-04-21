// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LotRowFormModal } from './lot-row-form-modal';

describe('LotRowFormModal', () => {
  it('날짜 입력을 commit 후 기존 UTC midnight 변환으로 제출한다', async () => {
    const onSubmit = vi.fn();

    render(<LotRowFormModal mode="add" onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('차수'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('매입가 (원)'), { target: { value: '70000' } });
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '3' } });

    const dateInput = screen.getByLabelText('매수일 (YYYY-MM-DD)');
    fireEvent.change(dateInput, { target: { value: '2026-4-1' } });
    fireEvent.blur(dateInput);

    fireEvent.click(screen.getByRole('button', { name: '추가' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          amountKrw: 210000,
          boughtAtMs: Date.parse('2026-04-01T00:00:00.000Z'),
          buyPrice: 70000,
          nth: 2,
          qty: 3,
        }),
      );
    });
  });
});
