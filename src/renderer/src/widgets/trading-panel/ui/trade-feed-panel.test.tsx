// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/shared/lib/use-flash-on-new', () => ({
  useFlashOnNew: () => new Set<string>(),
}));

import { TradeFeedPanel } from './trade-feed-panel';

describe('TradeFeedPanel', () => {
  it('가로 스크롤 래퍼와 컬럼 최소 너비를 함께 렌더링한다', () => {
    render(
      <TradeFeedPanel
        pdno="005930"
        name="삼성전자"
        feed={[
          {
            pdno: '005930',
            time: '101530',
            price: 70000,
            dayChange: 0,
            dayChangeRate: 0,
            tickDirection: 'UP',
            volume: 12,
            accumVolume: 4567,
            open: 69500,
            high: 70100,
            low: 69400,
            bestAsk: 70000,
            bestBid: 69900,
          },
        ]}
      />,
    );

    const region = screen.getByRole('region', { name: '실시간 체결' });
    const headerCells = region.querySelectorAll('.table-grid-header .table-grid-cell');

    expect(region.querySelector('.table-grid-hscroll-wrapper')).toBeInTheDocument();
    expect(headerCells).toHaveLength(4);
    expect(headerCells[0]).toHaveStyle({ minWidth: '11.2rem' });
    expect(headerCells[1]).toHaveStyle({ minWidth: '11.2rem' });
    expect(headerCells[3]).toHaveStyle({ minWidth: '20rem' });
  });
});
