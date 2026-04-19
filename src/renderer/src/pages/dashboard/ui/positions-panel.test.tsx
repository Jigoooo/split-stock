// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionsPanel } from './positions-panel';

describe('PositionsPanel', () => {
  it('행 클릭 시 onSelect를 호출하고 숫자를 포맷한다', () => {
    const onSelect = vi.fn();

    render(
      <PositionsPanel
        selectedPdno={null}
        onSelect={onSelect}
        positions={[
          {
            code: '005930',
            name: '삼성전자',
            qty: 1234,
            avgPrice: 70000,
            currentPrice: 71000,
            evalAmount: 87654321,
            pnlAmount: 123456,
            pnlRate: 1.23,
          },
        ]}
      />,
    );

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('87,654,321')).toBeInTheDocument();
    expect(screen.getByText('+123,456')).toBeInTheDocument();

    fireEvent.click(screen.getByText('삼성전자'));

    expect(onSelect).toHaveBeenCalledWith({ pdno: '005930', name: '삼성전자' });
  });
});
