// @vitest-environment jsdom
import { createStrategyRules, type StrategyProfile } from '@shared/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StrategyForm } from './strategy-form';

const initial: StrategyProfile = {
  version: 2,
  maxStages: 5,
  ...createStrategyRules(5, {
    amountKrw: 1_000_000,
    dropPct: 0.03,
    profitPct: 0.05,
  }),
  autoBuyEnabled: true,
  autoBuyOrderType: 'LIMIT',
  autoSellEnabled: true,
  autoSellOrderType: 'LIMIT',
};

describe('StrategyForm', () => {
  it('초기값 렌더링', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);

    expect(
      (screen.getByRole('textbox', { name: '최대 관리차수 (1~50)' }) as HTMLInputElement).value,
    ).toBe('5');
    expect(screen.getByRole('combobox', { name: '자동매매 상태' })).toHaveValue('ALL_ON');
    expect(screen.getByRole('textbox', { name: '2차 자동매수 하락률' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: '1차 자동매도 익절률' })).toHaveValue('5');
  });

  it('차수별 규칙 수정 후 저장 payload는 새 스키마 shape를 유지한다', () => {
    const onSubmit = vi.fn();
    render(<StrategyForm initial={initial} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('textbox', { name: '최대 관리차수 (1~50)' }), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '1차 매수금액' }), {
      target: { value: '1,500,000' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '2차 자동매수 하락률' }), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: '자동매매 설정 저장' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        maxStages: 6,
        buyRules: expect.arrayContaining([
          expect.objectContaining({ nth: 1, amountKrw: 1_500_000, triggerDropPct: null }),
          expect.objectContaining({ nth: 2, triggerDropPct: 0.04 }),
        ]),
      }),
    );
  });

  it('잘못된 값은 저장 버튼이 비활성화된다', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '2차 자동매수 하락률' }), {
      target: { value: '999' },
    });
    expect(screen.getByRole('button', { name: '자동매매 설정 저장' })).toBeDisabled();
  });

  it('프리셋 이름이 비어있으면 저장 버튼이 비활성화된다', () => {
    render(<StrategyForm initial={initial} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '프리셋 저장' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '프리셋 이름' }), {
      target: { value: '기본전략' },
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
      expect.objectContaining({
        buyRules: expect.arrayContaining([
          expect.objectContaining({ nth: 1, amountKrw: 1_000_000 }),
        ]),
      }),
    );
  });
});
