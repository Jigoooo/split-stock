// @vitest-environment jsdom
import type { FeeSettings } from '@renderer/entities/fee-settings';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeeSettingsForm } from './fee-settings-form';

const mocks = vi.hoisted(() => ({
  data: { buy: 0.015, sell: 0.015, tax: 0.2 } as FeeSettings,
  mutateAsync: vi.fn(async (payload: unknown) => payload),
}));

vi.mock('@renderer/entities/fee-settings', () => ({
  useGetFeeSettings: () => ({
    data: mocks.data,
    isPending: false,
    error: null,
  }),
  useUpdateFeeSettings: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
    error: null,
  }),
}));

describe('FeeSettingsForm', () => {
  beforeEach(() => {
    mocks.data = { buy: 0.015, sell: 0.015, tax: 0.2 };
    mocks.mutateAsync.mockClear();
  });

  it('저장 버튼은 수수료 값이 저장된 값과 같으면 비활성화된다', () => {
    render(<FeeSettingsForm env="real" />);

    const buyInput = screen.getByRole('textbox', { name: '매입 수수료 (%)' });
    const saveButton = screen.getByRole('button', { name: '저장' });

    expect(saveButton).toBeDisabled();

    fireEvent.change(buyInput, { target: { value: '0.02' } });
    expect(saveButton).not.toBeDisabled();

    fireEvent.change(buyInput, { target: { value: '0.015' } });
    expect(saveButton).toBeDisabled();
  });
});
