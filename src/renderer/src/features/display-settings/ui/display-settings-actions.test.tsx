// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartSettingsActions } from './chart-settings-actions';
import { GridDensityForm } from './grid-density-form';

describe('display settings save actions', () => {
  it('차트 저장 버튼은 변경 사항이 없으면 비활성화된다', () => {
    render(
      <ChartSettingsActions isDirty={false} isSaving={false} onReset={vi.fn()} onSave={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: '차트 설정 저장' })).toBeDisabled();
  });

  it('그리드 저장 버튼은 변경 사항이 있을 때만 활성화된다', () => {
    const { rerender } = render(
      <GridDensityForm
        rowHeightPx={26}
        isDirty={false}
        isSaving={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '그리드 설정 저장' })).toBeDisabled();

    rerender(
      <GridDensityForm
        rowHeightPx={28}
        isDirty={true}
        isSaving={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '그리드 설정 저장' })).not.toBeDisabled();
  });
});
