// @vitest-environment jsdom
import type { StrategyProfile } from '@shared/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StrategyForm } from './strategy-form';

const initial: StrategyProfile = {
  totalAmountKrw: 5_000_000,
  maxStages: 5,
  dropPct: 0.03,
  profitPct: 0.05,
};

describe('StrategyForm', () => {
  it('초기값 렌더링 (퍼센트 환산: 0.03 → 3, 금액은 콤마 표시)', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);
    expect(
      (screen.getByRole('textbox', { name: '총 투입 금액 (원)' }) as HTMLInputElement).value,
    ).toBe('5,000,000');
    expect(
      (screen.getByRole('textbox', { name: '하향매수 비율 (%)' }) as HTMLInputElement).value,
    ).toBe('3');
    expect((screen.getByRole('textbox', { name: '익절 비율 (%)' }) as HTMLInputElement).value).toBe(
      '5',
    );
  });

  it('콤마 표시 상태에서도 저장 payload는 숫자 shape 유지', () => {
    const onSubmit = vi.fn();
    render(<StrategyForm initial={initial} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole('textbox', { name: '총 투입 금액 (원)' }), {
      target: { value: '6,200,000' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '하향매수 비율 (%)' }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '전략 저장' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmountKrw: 6_200_000, dropPct: 0.04 }),
    );
  });

  it('잘못된 값은 저장 버튼 disabled', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '하향매수 비율 (%)' }), {
      target: { value: '999' }, // 999%>50%
    });
    expect(screen.getByRole('button', { name: '전략 저장' })).toBeDisabled();
  });

  it('프리셋 저장 — 이름 비어있으면 버튼 disabled', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '프리셋 저장' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: '프리셋 이름' }), {
      target: { value: '코스닥변동' },
    });
    expect(screen.getByRole('button', { name: '프리셋 저장' })).not.toBeDisabled();
  });

  it('프리셋 저장 클릭 → onSaveAsPreset(name, profile)', () => {
    const onSaveAsPreset = vi.fn();
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} onSaveAsPreset={onSaveAsPreset} />);
    fireEvent.change(screen.getByRole('textbox', { name: '프리셋 이름' }), {
      target: { value: '대형주' },
    });
    fireEvent.click(screen.getByRole('button', { name: '프리셋 저장' }));
    expect(onSaveAsPreset).toHaveBeenCalledWith(
      '대형주',
      expect.objectContaining({ dropPct: 0.03 }),
    );
  });
});
