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
    account: {
      getActive: {
        useQuery: () => ({
          data: { accountId: 1, account: null },
          isPending: false,
        }),
      },
      getBalanceWithLots: {
        useQuery: (_params: unknown, _opts: unknown) => ({
          data: {
            positions: [],
            deposit: 0,
            totalEval: 0,
            lotsByPdno: {
              '005930': [
                {
                  nth: 1,
                  buyPrice: 70000,
                  qty: 10,
                  amountKrw: 700000,
                  status: 'OPEN',
                  boughtAt: 0,
                },
                {
                  nth: 2,
                  buyPrice: 68000,
                  qty: 10,
                  amountKrw: 680000,
                  status: 'BUYING',
                  boughtAt: 0,
                },
              ],
            },
            strategiesByPdno: {},
          },
          isPending: false,
          error: null,
        }),
      },
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

describe('OrderTicket', () => {
  it('콤마 표시 상태에서도 숫자 payload로 주문한다 (확인 다이얼로그 통과)', async () => {
    placeMock.mockReset();
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
    fireEvent.change(screen.getByLabelText('주문 수량'), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText('주문 가격'), { target: { value: '70000' } });

    expect(screen.getByLabelText('주문 수량')).toHaveValue('12,345');
    expect(screen.getByLabelText('주문 가격')).toHaveValue('70,000');

    fireEvent.click(screen.getByRole('button', { name: '매수 주문' }));
    // 확인 다이얼로그 노출
    const dialog = screen.getByRole('dialog', { name: '주문 확인' });
    expect(dialog).toBeInTheDocument();
    // 확인 확정 버튼 클릭 시 place mutation 호출
    fireEvent.click(screen.getByRole('button', { name: '매수 주문 확정' }));
    expect(placeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pdno: '005930',
        side: 'BUY',
        qty: 12345,
        price: 70000,
        division: 'LIMIT',
      }),
    );
  });

  it('PROD 환경은 oneClick=true라도 확인 다이얼로그 강제 — 취소 시 place 호출 없음', () => {
    placeMock.mockReset();
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
    expect(screen.getByRole('dialog', { name: '주문 확인' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(placeMock).not.toHaveBeenCalled();
  });

  it('현재 OPEN/BUYING lot 개수 기반으로 다음 차수를 표시한다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자' }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );
    // mock: OPEN 1개 + BUYING 1개 = 2개 → 다음 차수 3
    expect(screen.getByText('3차')).toBeInTheDocument();
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
    expect(screen.getByLabelText('주문 가격')).toHaveValue('시장가');
  });
});
