// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LotRowFormModal } from './lot-row-form-modal';

describe('LotRowFormModal', () => {
  it('날짜 입력을 commit 후 기존 UTC midnight 변환으로 제출한다', async () => {
    const onSubmit = vi.fn();

    render(<LotRowFormModal onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('차수'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('매입가 (원)'), { target: { value: '70000' } });
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '3' } });

    const monthInput = screen.getByLabelText('매수일 월');
    const dayInput = screen.getByLabelText('매수일 일');
    fireEvent.change(monthInput, { target: { value: '4' } });
    fireEvent.blur(monthInput, { relatedTarget: dayInput });
    fireEvent.change(dayInput, { target: { value: '1' } });
    fireEvent.blur(dayInput);

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
