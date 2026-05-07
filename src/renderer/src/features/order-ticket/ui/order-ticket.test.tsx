// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    auth: {
      getEnv: {
        useQuery: () => ({ data: { env: 'MOCK', accountId: 1 }, isPending: false }),
      },
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
            // 매수 상한(deposit/price) · 매도 상한(positions.qty) UI 가드 테스트용 시드.
            // 테스트에서 qty 12,345 / price 70,000 주문을 검증하므로 deposit 은 여유롭게 확보.
            positions: [
              {
                code: '005930',
                name: '삼성전자',
                qty: 100_000,
                avgPrice: 69000,
                currentPrice: 70000,
                evalAmount: 7_000_000_000,
                pnlAmount: 100_000_000,
                pnlRate: 1.45,
              },
            ],
            deposit: 10_000_000_000,
            totalEval: 17_000_000_000,
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
    strategy: {
      getEffectiveMetas: {
        useQuery: () => ({ data: { strategiesByPdno: {} }, isPending: false, error: null }),
      },
    },
    // Phase 6 use-balance-with-lots: UPBIT 모드일 때만 활성 — stock 전용 테스트는 비활성 분기.
    crypto: {
      getBalances: {
        useQuery: () => ({ data: undefined, isPending: false, error: null }),
      },
      getTickers: {
        useQuery: () => ({ data: { tickers: [] }, isPending: false, error: null }),
      },
    },
    realtime: {
      watch: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      unwatch: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      onTicks: {
        useSubscription: () => ({ data: {}, status: 'success' }),
      },
      getLatestTicks: {
        useQuery: () => ({ data: { ticks: {} }, isPending: false, error: null }),
      },
    },
    safety: {
      getState: {
        useQuery: () => ({
          data: {
            master: true,
            bySymbol: {},
            errorLock: { active: false, reason: null, triggeredAt: null },
            updatedAt: 0,
          },
        }),
      },
    },
    useUtils: () => ({ order: { listActive: { invalidate: vi.fn() } } }),
  },
}));

import { DialogProvider } from '@renderer/shared/ui/dialog';
import { OrderTicket } from './order-ticket';

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient();
  const Provider = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <DialogProvider />
      {children}
    </QueryClientProvider>
  );
  return <Provider>{ui}</Provider>;
}

describe('OrderTicket', () => {
  it('매수/매도 버튼에 명령 단축키 배지를 표시하지 않는다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자', suggestedPrice: 70000 }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    expect(screen.getByRole('button', { name: '매수 주문' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '매도 주문' })).toBeInTheDocument();
    expect(screen.queryByText('F3')).toBeNull();
    expect(screen.queryByText('F4')).toBeNull();
  });

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
    fireEvent.click(screen.getByRole('button', { name: '매수 확정' }));
    await waitFor(() =>
      expect(placeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pdno: '005930',
          side: 'BUY',
          qty: 12345,
          price: 70000,
          division: 'LIMIT',
        }),
      ),
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
    expect(screen.getByRole('dialog', { name: '⚠ 실전(PROD) 매도 확인' })).toBeInTheDocument();
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

  it('SOLD 차수는 무시하고 현재 OPEN/BUYING 최대 차수 다음 번호를 표시한다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자' }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    expect(screen.getByText('3차')).toBeInTheDocument();
  });

  it('현재 선택 요약은 버튼 누르기 전 방향을 미리 보여주지 않는다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자' }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    expect(screen.getByText('현재 선택:')).toBeInTheDocument();
    expect(screen.getByText(/지정가 ·\s*1주/)).toBeInTheDocument();
    expect(screen.queryByText(/현재 선택: 매도/)).toBeNull();
    expect(screen.queryByText(/현재 선택: BUY/)).toBeNull();
  });

  it('호가로 채워진 가격은 현재 선택 요약에 반영 상태를 표시한다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자', suggestedPrice: 70000 }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    expect(screen.getByText('호가 반영')).toBeInTheDocument();
    expect(screen.getByText(/지정가 · 1주 · 70,000원/)).toBeInTheDocument();
  });

  it('매수 가능한 주문에서 매도가능 수량 초과는 수량 입력 보정 CTA로 노출하지 않는다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '000000', name: '신규종목', suggestedPrice: 70000 }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText('주문 수량'), { target: { value: '10' } });

    expect(screen.getByRole('button', { name: '매수 주문' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '매도 주문' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /주로 조정/ })).not.toBeInTheDocument();
    expect(screen.getByText(/매도 시 보유 수량 초과/)).toBeInTheDocument();
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
    // 구분 토글은 SegmentedToggle radiogroup. 시장가 radio 클릭 → 가격 입력 disabled.
    fireEvent.click(screen.getByRole('radio', { name: '시장가' }));
    expect(screen.getByLabelText('주문 가격')).toBeDisabled();
    expect(screen.getByLabelText('주문 가격')).toHaveValue('시장가');
  });

  it('구분 라벨을 눌러도 토글 상태가 바뀌지 않는다', () => {
    render(
      wrap(
        <OrderTicket
          selection={{ pdno: '005930', name: '삼성전자' }}
          isProd={false}
          oneClick={false}
        />,
      ),
    );

    // 구분 토글은 SegmentedToggle radiogroup. 라벨 클릭은 no-op이어야 한다.
    const limit = screen.getByRole('radio', { name: '지정가' });
    expect(limit).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('구분', { selector: '.order-ticket-form__label' }));
    expect(limit).toHaveAttribute('aria-checked', 'true');
  });
});
