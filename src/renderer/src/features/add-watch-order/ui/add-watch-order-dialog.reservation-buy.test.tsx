// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddWatchOrderDialog } from './add-watch-order-dialog';

vi.mock('@renderer/entities/stock', () => ({
  StockPickerList: () => <div>stock-picker</div>,
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      watch: {
        list: { invalidate: vi.fn() },
        getControlState: { invalidate: vi.fn() },
        history: { invalidate: vi.fn() },
      },
    }),
    watch: {
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      getReservationBuyDraft: {
        useQuery: () => ({ data: undefined, error: null, isLoading: false }),
      },
    },
  },
}));

describe('AddWatchOrderDialog reservation buy contraction', () => {
  it('매도/비교 선택 없이 예약매수 전용 설명만 노출', () => {
    render(
      <AddWatchOrderDialog open accountId={1} prefill={null} onClose={() => {}} layout="modal" />,
    );

    expect(screen.queryByLabelText('주문구분')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('비교')).not.toBeInTheDocument();
    expect(screen.queryByText('목표가 이상')).not.toBeInTheDocument();
    expect(screen.getByText('감시가격 이하 도달 시 예약매수 실행')).toBeInTheDocument();
  });
});
