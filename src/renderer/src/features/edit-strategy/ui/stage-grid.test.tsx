// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AutoFillParams, StageRow } from '../model/use-stage-grid';
import { StageGrid } from './stage-grid';

const defaultProps = {
  raw: { dropPct: '3', profitPct: '5' },
  errors: { dropPct: undefined, profitPct: undefined },
  dropBaseline: 'PREV_LOT' as const,
  rows: [] as StageRow[],
  maxStages: 5,
  disabled: false,
  onUpdate: vi.fn(() => vi.fn()),
  onToggleDropBaseline: vi.fn(),
  onAutoFill: vi.fn(),
};

describe('StageGrid', () => {
  it('기본 렌더링 — 하향매수/익절 입력 필드 노출', () => {
    render(<StageGrid {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: '하향매수 비율 (%)' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '익절 비율 (%)' })).toBeTruthy();
  });

  it('dropBaseline 토글 버튼 — 직전차수 표시', () => {
    render(<StageGrid {...defaultProps} />);
    expect(screen.getByRole('button', { name: /하향매수 기준: 직전차수/ })).toBeTruthy();
  });

  it('dropBaseline FIRST_LOT — 처음매수가 표시', () => {
    render(<StageGrid {...defaultProps} dropBaseline="FIRST_LOT" />);
    expect(screen.getByRole('button', { name: /하향매수 기준: 처음매수가/ })).toBeTruthy();
  });

  it('onToggleDropBaseline 클릭 시 호출', () => {
    const onToggle = vi.fn();
    render(<StageGrid {...defaultProps} onToggleDropBaseline={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /하향매수 기준/ }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('감지% 자동입력 도구 인라인 렌더링', () => {
    render(<StageGrid {...defaultProps} />);
    expect(screen.getByLabelText('감지% 자동입력 도구')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '감지% 간격' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '매수금액 (원)' })).toBeTruthy();
  });

  it('자동 채우기 버튼 — interval 미입력 시 disabled', () => {
    render(<StageGrid {...defaultProps} maxStages={10} />);
    expect(screen.getByRole('button', { name: '1~10차 자동 채우기' })).toBeDisabled();
  });

  it('자동 채우기 버튼 — interval 입력 후 활성화', () => {
    render(<StageGrid {...defaultProps} maxStages={5} />);
    fireEvent.change(screen.getByRole('textbox', { name: '감지% 간격' }), {
      target: { value: '3' },
    });
    expect(screen.getByRole('button', { name: '1~5차 자동 채우기' })).not.toBeDisabled();
  });

  it('자동 채우기 클릭 → onAutoFill 호출 (올바른 params)', () => {
    const onAutoFill = vi.fn();
    render(<StageGrid {...defaultProps} maxStages={5} onAutoFill={onAutoFill} />);

    fireEvent.change(screen.getByRole('textbox', { name: '감지% 간격' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '매수금액 (원)' }), {
      target: { value: '100000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '1~5차 자동 채우기' }));

    expect(onAutoFill).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AutoFillParams>>({
        dropPctInterval: '3',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 5,
      }),
    );
  });

  it('rows 채워진 후 차수별 테이블 표시', () => {
    const rows: StageRow[] = [
      { stage: 1, dropPct: '3', amountKrw: '100000' },
      { stage: 2, dropPct: '3', amountKrw: '100000' },
    ];
    render(<StageGrid {...defaultProps} rows={rows} />);
    expect(screen.getByText('1차')).toBeTruthy();
    expect(screen.getByText('2차')).toBeTruthy();
    expect(screen.getAllByText('100,000')).toBeTruthy();
  });

  it('rows 비어있을 때 차수 테이블 없음', () => {
    render(<StageGrid {...defaultProps} rows={[]} />);
    expect(screen.queryByLabelText('차수별 매수 설정')).toBeNull();
  });

  it('미리보기 — interval 입력 후 미리보기 테이블 표시', () => {
    render(<StageGrid {...defaultProps} maxStages={5} />);
    fireEvent.change(screen.getByRole('textbox', { name: '감지% 간격' }), {
      target: { value: '3' },
    });
    expect(screen.getByLabelText('자동채우기 미리보기')).toBeTruthy();
  });

  it('disabled=true 시 입력 필드 비활성화', () => {
    render(<StageGrid {...defaultProps} disabled />);
    expect((screen.getByRole('textbox', { name: '감지% 간격' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('textbox', { name: '매수금액 (원)' }) as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
