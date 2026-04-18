// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const placeMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    order: {
      placeCash: {
        useMutation: () => ({
          mutateAsync: placeMock,
          isPending: false,
          error: null,
        }),
      },
      cancelMany: {
        useMutation: () => ({
          mutateAsync: cancelMock,
          isPending: false,
          error: null,
        }),
      },
      listActive: { invalidate: vi.fn() },
    },
    useUtils: () => ({ order: { listActive: { invalidate: vi.fn() } } }),
  },
}));

import { OrderTicket } from './order-ticket';

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient();
  const Provider = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return <Provider>{ui}</Provider>;
}

const origConfirm = window.confirm;

describe('OrderTicket', () => {
  it('가격/수량 입력 후 매수 클릭 → confirm → place 호출', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    placeMock.mockResolvedValue({ odno: 'ODN1' });
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자', suggestedPrice: 70000 }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: '주문 수량' }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: '매수 주문' }));
    // confirm 호출됨
    expect(window.confirm).toHaveBeenCalled();
    // 비동기 mutateAsync는 await 없이 즉시 호출 확인
    expect(placeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pdno: '005930',
        side: 'BUY',
        qty: 10,
        price: 70000,
        division: 'LIMIT',
      }),
    );
    window.confirm = origConfirm;
  });

  it('PROD 환경은 oneClick=true라도 confirm 강제', () => {
    window.confirm = vi.fn().mockReturnValue(false);
    placeMock.mockClear();
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자', suggestedPrice: 70000 }}
          isProd={true}
          oneClick={true}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '매도 주문' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(placeMock).not.toHaveBeenCalled();
    window.confirm = origConfirm;
  });

  it('시장가 선택 시 가격 입력 disabled', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자' }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );
    const divSelect = screen.getByRole('combobox', { name: '주문 구분' });
    fireEvent.change(divSelect, { target: { value: 'MARKET' } });
    expect(screen.getByLabelText('주문 가격')).toBeDisabled();
  });
});
