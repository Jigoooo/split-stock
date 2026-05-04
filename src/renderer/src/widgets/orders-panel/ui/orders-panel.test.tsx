// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedOrder } from '../model/normalized-order';
import { OrdersPanel } from './orders-panel';

const baseOrder: NormalizedOrder = {
  id: 'OID-1',
  symbol: '005930',
  symbolLabel: '삼성전자 (005930)',
  side: 'BUY',
  qty: 10,
  remainingQty: 7,
  filledQty: 3,
  price: 70000,
  stateLabel: '부분체결',
  stateVariant: 'up',
  placedAt: new Date('2026-04-20T10:00:00+09:00').toISOString(),
};

describe('OrdersPanel (broker-agnostic)', () => {
  it('NormalizedOrder shape 만으로 렌더링한다 — broker prop 분기 없음', () => {
    render(
      <OrdersPanel
        mode="active"
        title="미체결 주문"
        columns={['symbol', 'side', 'remaining', 'price', 'state']}
        orders={[baseOrder]}
      />,
    );

    expect(screen.getByText('삼성전자 (005930)')).toBeInTheDocument();
    expect(screen.getByText('매수')).toBeInTheDocument();
    expect(screen.getByText('7 / 10')).toBeInTheDocument();
    expect(screen.getByText('체결 3주')).toBeInTheDocument();
    expect(screen.getByText('부분체결')).toBeInTheDocument();
  });

  it('selectionAction 슬롯과 selection prop 으로 외부 합성된 batch action UI 를 노출한다', () => {
    const onToggle = vi.fn();
    const action = vi.fn();
    render(
      <OrdersPanel
        mode="active"
        title="미체결 주문"
        columns={['select', 'symbol', 'side']}
        orders={[baseOrder]}
        selection={{ selectedIds: new Set(['OID-1']), onToggle }}
        selectionAction={
          <button type="button" onClick={action}>
            선택 취소 (1)
          </button>
        }
      />,
    );

    expect(screen.getByRole('button', { name: '선택 취소 (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '선택 OID-1' }));
    expect(onToggle).toHaveBeenCalledWith('OID-1');
  });

  it('warning chip 은 wrapper 가 NormalizedOrder.warning 으로 합성한다 (orgNo 누락 케이스)', () => {
    render(
      <OrdersPanel
        mode="active"
        title="미체결 주문"
        columns={['symbol', 'state']}
        orders={[
          {
            ...baseOrder,
            warning: { label: 'orgNo ✕', title: '원주문번호 누락' },
          },
        ]}
      />,
    );

    expect(screen.getByText('orgNo ✕')).toBeInTheDocument();
    expect(screen.getByTitle('원주문번호 누락')).toBeInTheDocument();
  });

  it('cancellable=true + onCancel 일 때만 취소 버튼이 노출된다', () => {
    const onCancel = vi.fn();
    render(
      <OrdersPanel
        mode="active"
        title="주문"
        columns={['symbol', 'manage']}
        orders={[
          { ...baseOrder, id: 'A', cancellable: true },
          { ...baseOrder, id: 'B', cancellable: false },
        ]}
        onCancel={onCancel}
      />,
    );

    const cancelButtons = screen.getAllByRole('button', { name: '취소' });
    expect(cancelButtons).toHaveLength(1);
    const [firstButton] = cancelButtons;
    if (!firstButton) throw new Error('expected one cancel button');
    fireEvent.click(firstButton);
    expect(onCancel).toHaveBeenCalledWith('A');
  });

  it('priceLabel override 가 있으면 가격 컬럼에 그대로 노출된다 (시장가/DecimalString 변환 결과)', () => {
    render(
      <OrdersPanel
        mode="filled"
        title="내 체결"
        columns={['symbol', 'price']}
        orders={[{ ...baseOrder, priceLabel: '시장가' }]}
      />,
    );

    expect(screen.getByText('시장가')).toBeInTheDocument();
  });

  it('disabledPlaceholder 가 주어지면 표 대신 placeholder 만 렌더한다', () => {
    render(
      <OrdersPanel
        mode="active"
        title="주문"
        columns={['symbol']}
        orders={[]}
        disabledPlaceholder="활성 Upbit 실전 계좌에서만 조회됩니다."
      />,
    );

    expect(screen.getByText('활성 Upbit 실전 계좌에서만 조회됩니다.')).toBeInTheDocument();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
  });

  it('orders 가 비어 있으면 emptyText 를 노출한다', () => {
    render(
      <OrdersPanel
        mode="filled"
        title="내 체결"
        columns={['symbol']}
        orders={[]}
        emptyText="체결 내역이 없습니다"
      />,
    );

    expect(screen.getByText('체결 내역이 없습니다')).toBeInTheDocument();
  });
});
