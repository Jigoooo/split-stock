// @vitest-environment jsdom
import type { WatchOrder } from '@renderer/entities/watch-order';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WatchList } from './watch-list';

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
      pause: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      cancel: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    market: {
      listAllStock: {
        useQuery: () => ({
          data: {
            entries: [
              { pdno: '005930', name: '삼성전자', sector: '전기전자' },
              { pdno: '000660', name: 'SK하이닉스', sector: '반도체' },
            ],
          },
        }),
      },
    },
  },
}));

const baseOrder: WatchOrder = {
  id: 1,
  accountId: 1,
  pdno: '005930',
  source: 'CUSTOM',
  side: 'BUY',
  targetPrice: 60_000,
  comparator: 'LTE',
  orderType: 'LIMIT',
  qtyOrAmountMode: 'QTY',
  qty: 10,
  amountKrw: null,
  nth: null,
  sourceRefId: null,
  expiresAt: null,
  status: 'WATCHING',
  lastFailureReason: null,
  metadata: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  executedAt: null,
};

function makeOrder(overrides: Partial<WatchOrder>): WatchOrder {
  return { ...baseOrder, ...overrides };
}

describe('WatchList reservation buy contraction', () => {
  it('방향/비교 컬럼을 숨기고 예약매수 라벨을 사용', () => {
    render(
      <WatchList orders={[baseOrder]} isPending={false} error={null} allowMutations={false} />,
    );

    expect(screen.queryByText('방향')).not.toBeInTheDocument();
    expect(screen.queryByText('비교')).not.toBeInTheDocument();
    expect(screen.getByText('예약매수')).toBeInTheDocument();
    expect(screen.getByText('삼성전자 (005930)')).toBeInTheDocument();
  });

  it('읽기 전용 탭은 선택 checkbox와 작업 컬럼 없이 고정 요약 툴바만 표시', () => {
    render(
      <WatchList
        orders={[makeOrder({ id: 2, pdno: '000660', status: 'EXECUTED' })]}
        isPending={false}
        error={null}
        allowMutations={false}
        summaryLabel="실행내역"
      />,
    );

    expect(screen.getByRole('toolbar', { name: '자동감시 탭 요약' })).toHaveTextContent('실행내역');
    expect(screen.getByRole('toolbar', { name: '자동감시 탭 요약' })).toHaveTextContent('1건');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /작업/ })).not.toBeInTheDocument();
    expect(document.querySelector('.table-grid-hscroll-wrapper')).toBeInTheDocument();
  });

  it('현황 툴바는 항상 렌더링되고 선택 상태에 따라 시작/중지/삭제를 활성화', () => {
    render(
      <WatchList
        orders={[
          makeOrder({ id: 1, pdno: '005930', status: 'WATCHING' }),
          makeOrder({ id: 2, pdno: '000660', status: 'PAUSED' }),
        ]}
        isPending={false}
        error={null}
        allowMutations
      />,
    );

    const toolbar = screen.getByRole('toolbar', { name: '선택한 자동감시 작업' });
    const start = screen.getByRole('button', { name: '시작' });
    const stop = screen.getByRole('button', { name: '중지' });
    const deleteButton = screen.getByRole('button', { name: '삭제' });

    expect(toolbar).toHaveTextContent('0건 선택');
    expect(start).toBeDisabled();
    expect(stop).toBeDisabled();
    expect(deleteButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: '자동감시 삼성전자 (005930) 선택' }));
    expect(toolbar).toHaveTextContent('1건 선택');
    expect(start).toBeDisabled();
    expect(stop).toBeEnabled();
    expect(deleteButton).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: '자동감시 SK하이닉스 (000660) 선택' }));
    expect(toolbar).toHaveTextContent('2건 선택');
    expect(toolbar).toHaveTextContent('상태가 섞인 항목');
    expect(start).toBeDisabled();
    expect(stop).toBeDisabled();
    expect(deleteButton).toBeEnabled();
  });

  it('우클릭 메뉴는 대상 종목을 헤더에 표시하고 선택 row 우클릭은 선택 묶음을 대상으로 함', () => {
    render(
      <WatchList
        orders={[
          makeOrder({ id: 1, pdno: '005930', status: 'WATCHING' }),
          makeOrder({ id: 2, pdno: '000660', status: 'WATCHING' }),
        ]}
        isPending={false}
        error={null}
        allowMutations
      />,
    );

    expect(screen.queryByText('작업')).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('삼성전자 (005930)'));

    expect(screen.getByTestId('watch-context-menu')).toHaveTextContent('삼성전자 (005930)');
    expect(screen.getByTestId('watch-context-menu')).toHaveTextContent('중지 (1건)');
    fireEvent.click(screen.getByRole('button', { name: '컨텍스트 메뉴 닫기' }));

    fireEvent.click(screen.getByRole('checkbox', { name: '자동감시 삼성전자 (005930) 선택' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '자동감시 SK하이닉스 (000660) 선택' }));
    fireEvent.contextMenu(screen.getByText('삼성전자 (005930)'));

    expect(screen.getByTestId('watch-context-menu')).toHaveTextContent('삼성전자 (005930) 외 1건');
    expect(screen.getByTestId('watch-context-menu')).toHaveTextContent('중지 (2건)');
  });
});
