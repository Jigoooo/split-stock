// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionsGrid } from './ui/positions-grid';

// useVirtualizer — 가상화 없이 items 를 직접 노출하도록 stub
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 36,
      })),
    measureElement: vi.fn(),
  }),
}));

const mockUsePositionsGrid = vi.fn();

vi.mock('./model/use-positions-grid', () => ({
  usePositionsGrid: () => mockUsePositionsGrid(),
}));

const makeRow = (code: string, name: string) => ({
  position: {
    code,
    name,
    qty: 10,
    avgPrice: 50000,
    currentPrice: 52000,
    evalAmount: 520000,
    pnlAmount: 20000,
    pnlRate: 0.04,
  },
  lots: [],
  rowMaxStages: 2,
});

describe('PositionsGrid', () => {
  it('마운트 + 기본 컬럼 헤더 렌더링', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      rows: [],
      gridMaxStages: 1,
    });

    render(<PositionsGrid accountId={1} />);

    expect(screen.getByRole('region', { name: /보유 종목 그리드/ })).toBeInTheDocument();
    expect(screen.getByText('종목명')).toBeInTheDocument();
    expect(screen.getByText('수량')).toBeInTheDocument();
    expect(screen.getByText('매입가')).toBeInTheDocument();
    expect(screen.getByText('현재가')).toBeInTheDocument();
  });

  it('[+] 클릭 시 expand 상태 토글', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      rows: [makeRow('005930', '삼성전자')],
      gridMaxStages: 2,
    });

    render(<PositionsGrid accountId={1} />);

    const expandBtn = screen.getByRole('button', { name: '차수 펼치기' });
    expect(expandBtn).toBeInTheDocument();
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: '차수 접기' })).toBeInTheDocument();
  });

  it('종목 row 클릭 → onSelect 호출', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      rows: [makeRow('005930', '삼성전자')],
      gridMaxStages: 2,
    });

    const onSelect = vi.fn();
    render(<PositionsGrid accountId={1} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('삼성전자'));
    expect(onSelect).toHaveBeenCalledWith('005930');
  });

  it('차트 아이콘 클릭 → openPopout("trade") + assignStock 호출, onSelect 미호출', () => {
    mockUsePositionsGrid.mockReturnValue({
      isPending: false,
      error: null,
      rows: [makeRow('005930', '삼성전자')],
      gridMaxStages: 2,
    });

    const openPopout = vi.fn().mockResolvedValue({ ok: true });
    const assignStock = vi.fn();
    Object.defineProperty(window, 'appShell', {
      value: { openPopout, assignStock },
      configurable: true,
    });

    const onSelect = vi.fn();
    render(<PositionsGrid accountId={1} onSelect={onSelect} />);

    const chartBtn = screen.getByRole('button', { name: '삼성전자 차트' });
    fireEvent.click(chartBtn);

    expect(openPopout).toHaveBeenCalledWith('trade');
    expect(assignStock).toHaveBeenCalledWith('005930', '삼성전자');
    expect(onSelect).not.toHaveBeenCalled();

    // 정리
    Object.defineProperty(window, 'appShell', { value: undefined, configurable: true });
  });
});
