// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfitCalculatorPage } from './profit-calculator-page';

const mocks = vi.hoisted(() => ({
  setAlwaysOnTop: vi.fn(async () => undefined),
}));

vi.mock('@renderer/entities/fee-settings', () => ({
  useGetFeeSettings: () => ({
    data: { buy: 0.015, sell: 0.015, tax: 0.225 },
    isPending: false,
    error: null,
  }),
}));

describe('ProfitCalculatorPage', () => {
  beforeEach(() => {
    mocks.setAlwaysOnTop.mockClear();
    Object.defineProperty(window, 'appShell', {
      value: { setAlwaysOnTop: mocks.setAlwaysOnTop },
      configurable: true,
    });
  });

  it('목표 수익률 계산 결과와 항상 위 토글을 제공한다', () => {
    render(<ProfitCalculatorPage />);

    expect(screen.getByRole('heading', { name: '수익률 계산기' })).toBeInTheDocument();
    expect(screen.getByText('예상 결과액')).toBeInTheDocument();
    expect(screen.getByText('1,050,158원')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '항상 위' }));
    expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('매도금액 기준 탭에서 프리셋과 비용 반영 상태를 갱신한다', () => {
    render(<ProfitCalculatorPage />);

    fireEvent.click(screen.getByRole('radio', { name: '매도금액 기준' }));
    expect(screen.getByText('계산 수익률')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(screen.getByRole('textbox', { name: '매도금액' })).toHaveValue('1,100,000');

    fireEvent.click(screen.getByRole('checkbox', { name: /수수료 및 세금 포함/ }));
    expect(screen.getByText('계산 반영')).toBeInTheDocument();
  });
});
