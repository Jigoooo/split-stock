// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const createWatchOrder = vi.fn();
const cancelWatchOrder = vi.fn();
const getReservationBuyDraft = vi.fn();
const invalidateWatchList = vi.fn();
const invalidateWatchControlState = vi.fn();
const invalidateWatchHistory = vi.fn();
const updateWatchOrder = vi.fn();
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
let reservationBuyDraftData: unknown = null;

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
        getControlState: {
          invalidate: invalidateWatchControlState,
        },
        history: {
          invalidate: invalidateWatchHistory,
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
      getReservationBuyDraft: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          getReservationBuyDraft(input, options);
          return {
            data: options?.enabled === false ? undefined : reservationBuyDraftData,
            error: null,
            isLoading: false,
          };
        },
      },
    },
  },
}));

vi.mock('@renderer/entities/stock', () => ({
  StockPickerList: ({
    onSelect,
  }: {
    onSelect: (entry: { pdno: string; name: string; sector: null }) => void;
  }) => (
    <button
      type="button"
      data-testid="stock-picker-list"
      onClick={() => onSelect({ pdno: '005930', name: '삼성전자', sector: null })}
    >
      삼성전자 선택
    </button>
  ),
}));

import { AddWatchOrderDialog } from './add-watch-order-dialog';

function makeDraft() {
  return {
    quote: {
      symbol: '005930',
      price: 100000,
      dayChange: -1200,
      dayChangeRate: -1.19,
      accumVolume: 1234567,
      open: 101500,
      high: 102000,
      low: 99200,
      upperLimit: 130000,
      lowerLimit: 70000,
      prevClose: 101200,
    },
    orderbookTop: { bestAsk: 100100, bestBid: 100000, expectedPrice: null },
    rangeContext: {
      candleCount: 80,
      dataQuality: 'normal',
      dataQualityReason: '일봉 80개',
      analysisConfidence: 'med',
      lastClose: 99500,
      box: { low: 94000, mid: 99000, high: 104000 },
      supportResistance: {
        supports: [97000, 94000],
        resistances: [104000],
        nearestSupportPct: 3,
        nearestResistancePct: 4,
      },
      rangePct120d: 10.1,
    },
    priceCandidates: [
      {
        id: 'nearest-support',
        label: '지지선',
        price: 97000,
        distancePct: -3,
        reason: '현재가 아래 최근접 지지선',
        confidence: 'med',
      },
      {
        id: 'box-low',
        label: '박스하단',
        price: 94000,
        distancePct: -6,
        reason: '최근 120일 percentile 박스 하단',
        confidence: 'med',
      },
      {
        id: 'pullback-2',
        label: '-2%',
        price: 98000,
        distancePct: -2,
        reason: '현재가 기준 2% 눌림',
        confidence: 'low',
      },
    ],
    recommended: {
      targetPrice: 97000,
      priceCandidateId: 'nearest-support',
      orderType: 'LIMIT',
      qtyOrAmountMode: 'AMOUNT',
      amountKrw: 1000000,
      expiresAtMs: Date.parse('2099-06-18T23:59:59'),
    },
    warnings: [],
    sourceStatus: {
      quote: 'used',
      orderbook: 'used',
      candles: 'cache',
      strategy: 'default',
    },
  };
}

describe('AddWatchOrderDialog', () => {
  it('만료일 직접 입력 정규화 후 달력 선택으로 다시 변경하고 저장한다', async () => {
    createWatchOrder.mockReset();
    cancelWatchOrder.mockReset();
    getReservationBuyDraft.mockReset();
    invalidateWatchList.mockReset();
    invalidateWatchControlState.mockReset();
    invalidateWatchHistory.mockReset();
    updateWatchOrder.mockReset();
    reservationBuyDraftData = makeDraft();
    createWatchOrder.mockResolvedValue({ order: { id: 1 } });
    invalidateWatchList.mockResolvedValue(undefined);
    invalidateWatchControlState.mockResolvedValue(undefined);
    invalidateWatchHistory.mockResolvedValue(undefined);

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

  it('종목 선택 시 현재가 strip 과 추천 실행조건을 pristine 필드에 자동 채운다', async () => {
    reservationBuyDraftData = makeDraft();
    getReservationBuyDraft.mockReset();

    render(<AddWatchOrderDialog accountId={1} open={true} onClose={vi.fn()} prefill={null} />);

    fireEvent.click(screen.getByRole('button', { name: '삼성전자 선택' }));

    await waitFor(() => {
      expect(screen.getByLabelText('감시가격')).toHaveValue('97,000');
    });
    expect(screen.getByText('현재가')).toBeInTheDocument();
    expect(screen.getByText('100,000원')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '가격 판단' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '추천 감시가' })).toHaveTextContent(
      '현재가 대비 -3.0%',
    );
    expect(screen.getByRole('region', { name: '가격 근거' })).toHaveTextContent(
      '박스 · 지지저항 · 호가',
    );
    expect(screen.queryByRole('button', { name: '추천값 적용' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('주문타입')).toHaveTextContent('지정가');
    expect(screen.getByLabelText('금액/수량')).toHaveTextContent('금액');
    expect(screen.getByLabelText('주문금액')).toHaveValue('1,000,000');
    expect(screen.getByLabelText('유효일 연도')).toHaveValue('2099');
  });

  it('사용자가 수정한 감시가격은 draft 재로딩으로 덮어쓰지 않는다', async () => {
    reservationBuyDraftData = makeDraft();

    render(<AddWatchOrderDialog accountId={1} open={true} onClose={vi.fn()} prefill={null} />);

    fireEvent.change(screen.getByLabelText('감시가격'), { target: { value: '95000' } });
    fireEvent.click(screen.getByRole('button', { name: '삼성전자 선택' }));

    await waitFor(() => {
      expect(screen.getByLabelText('감시가격')).toHaveValue('95,000');
    });
  });

  it('추천 chip 클릭 시 해당 후보 가격을 명시적으로 적용한다', async () => {
    reservationBuyDraftData = makeDraft();

    render(<AddWatchOrderDialog accountId={1} open={true} onClose={vi.fn()} prefill={null} />);

    fireEvent.click(screen.getByRole('button', { name: '삼성전자 선택' }));
    fireEvent.click(await screen.findByRole('button', { name: /박스하단/ }));

    expect(screen.getByLabelText('감시가격')).toHaveValue('94,000');
  });

  it('감시가격이 현재가 이상이면 저장 직후 실행 가능 경고를 alert 로 노출한다', async () => {
    reservationBuyDraftData = makeDraft();

    render(<AddWatchOrderDialog accountId={1} open={true} onClose={vi.fn()} prefill={null} />);

    fireEvent.click(screen.getByRole('button', { name: '삼성전자 선택' }));
    fireEvent.change(screen.getByLabelText('감시가격'), { target: { value: '100000' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('저장 직후 실행 가능');
    });
  });
});
