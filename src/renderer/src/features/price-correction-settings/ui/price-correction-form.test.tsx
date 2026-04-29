// @vitest-environment jsdom
import type { PriceCorrectionSettings } from '@renderer/entities/price-correction-settings';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceCorrectionForm } from './price-correction-form';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutate: vi.fn(),
  settings: { buy: 'AGGRESSIVE', sell: 'AGGRESSIVE' } as PriceCorrectionSettings,
}));

vi.mock('@renderer/entities/price-correction-settings', () => ({
  useGetPriceCorrectionSettings: () => ({
    isPending: false,
    error: null,
    settings: mocks.settings,
  }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      priceCorrection: {
        getSettings: { invalidate: mocks.invalidate },
      },
    }),
    priceCorrection: {
      updateSettings: {
        useMutation: () => ({
          mutate: mocks.mutate,
          isPending: false,
        }),
      },
    },
  },
}));

describe('PriceCorrectionForm', () => {
  beforeEach(() => {
    mocks.invalidate.mockClear();
    mocks.mutate.mockClear();
    mocks.settings = { buy: 'AGGRESSIVE', sell: 'AGGRESSIVE' };
  });

  it('저장 버튼은 저장된 호가 보정 설정과 같으면 비활성화된다', () => {
    render(<PriceCorrectionForm />);

    const saveButton = screen.getByRole('button', { name: '호가 자동 보정 저장' });
    const buyGroup = screen.getByRole('radiogroup', { name: '자동 매수 호가 전략' });

    expect(saveButton).toBeDisabled();

    fireEvent.click(within(buyGroup).getByRole('radio', { name: /유리한 가격 우선/ }));
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(within(buyGroup).getByRole('radio', { name: /즉시 체결 우선/ }));
    expect(saveButton).toBeDisabled();
  });
});
