// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectionLimits } from './protection-limits';
import { RateGuard } from './rate-guard';
import { TimeWindows } from './time-windows';

const mocks = vi.hoisted(() => ({
  handleFieldChange: vi.fn(),
  invalidateProtection: vi.fn(),
  invalidateRateGuard: vi.fn(),
  invalidateTradingWindows: vi.fn(),
  rateGuardMutate: vi.fn(),
  tradingWindowUpsert: vi.fn(),
}));

vi.mock('../model/use-protection-limits-form', () => ({
  useProtectionLimitsForm: () => ({
    accountId: 1,
    isPending: false,
    error: null,
    resolved: {
      perSymbolDailyMaxBuysEnabled: false,
      perSymbolDailyMaxBuys: '',
      dailyTotalMaxAmountEnabled: true,
      dailyTotalMaxAmount: '100000',
      dailyTotalMaxCountEnabled: false,
      dailyTotalMaxCount: '',
      accountTotalMaxAmountEnabled: false,
      accountTotalMaxAmount: '',
    },
    isSaving: false,
    isDirty: false,
    handleFieldChange: mocks.handleFieldChange,
    handleSave: vi.fn(),
  }),
}));

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => ({ accountId: 1 }),
}));

vi.mock('@renderer/entities/rate-guard', () => ({
  useRateGuardSettings: () => ({
    isPending: false,
    error: null,
    settings: { enabled: false, windowSeconds: 40, maxCount: 5 },
  }),
}));

vi.mock('@renderer/entities/trading-window', async () => {
  const actual = await vi.importActual<typeof import('@renderer/entities/trading-window')>(
    '@renderer/entities/trading-window',
  );
  return {
    ...actual,
    useTradingWindows: () => ({
      isPending: false,
      error: null,
      windows: [
        {
          id: 1,
          accountId: 1,
          side: 'BUY',
          slot: 1,
          enabled: true,
          startMinute: 540,
          endMinute: 930,
        },
        {
          id: 2,
          accountId: 1,
          side: 'SELL',
          slot: 1,
          enabled: true,
          startMinute: 540,
          endMinute: 930,
        },
      ],
    }),
  };
});

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      protection: { get: { invalidate: mocks.invalidateProtection } },
      rateGuard: { getSettings: { invalidate: mocks.invalidateRateGuard } },
      tradingWindows: { list: { invalidate: mocks.invalidateTradingWindows } },
    }),
    rateGuard: {
      updateSettings: {
        useMutation: () => ({
          mutate: mocks.rateGuardMutate,
          isPending: false,
        }),
      },
    },
    tradingWindows: {
      upsert: {
        useMutation: () => ({
          mutate: mocks.tradingWindowUpsert,
          isPending: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

describe('Strategy safety settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('보호 한도는 항목별 스위치를 표시하고 OFF 항목 값은 보존용 기본값으로 보인다', () => {
    render(<ProtectionLimits />);

    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByRole('textbox', { name: '종목별 1일 최대 매수 횟수' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '종목별 1일 최대 매수 횟수' })).toHaveValue('3');

    fireEvent.click(screen.getByRole('switch', { name: '종목별 1일 최대 매수 횟수 사용 여부' }));

    expect(mocks.handleFieldChange).toHaveBeenCalledWith('perSymbolDailyMaxBuysEnabled', true);
    expect(mocks.handleFieldChange).toHaveBeenCalledWith('perSymbolDailyMaxBuys', '3');
  });

  it('보호 한도 저장 버튼은 변경 사항이 없으면 비활성화된다', () => {
    render(<ProtectionLimits />);

    expect(screen.getByRole('button', { name: '보호 한도 저장' })).toBeDisabled();
  });

  it('연속매수 방지는 스위치 기반으로 켜고 끈다', () => {
    render(<RateGuard />);

    expect(screen.getByRole('switch', { name: '연속 자동매수 방지 사용 여부' })).toHaveTextContent(
      '끄기',
    );
    expect(screen.getByRole('textbox', { name: '감지 윈도우 초' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '최대 매수 시도 횟수' })).toBeDisabled();
  });

  it('연속매수 방지 저장 버튼은 기존 설정과 같으면 비활성화된다', () => {
    render(<RateGuard />);

    const saveButton = screen.getByRole('button', { name: '연속매수방지 저장' });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole('switch', { name: '연속 자동매수 방지 사용 여부' }));
    expect(saveButton).not.toBeDisabled();
  });

  it('매매 시간대 설정은 매수 슬롯만 표시하고 매도 슬롯은 숨긴다', () => {
    render(<TimeWindows />);

    expect(screen.getByText('매수 허용 시간대')).toBeInTheDocument();
    expect(screen.queryByText('매도 허용 시간대')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'BUY 슬롯 1 사용 여부' })).toBeInTheDocument();
  });

  it('매매 시간대 저장 버튼은 정규화된 시간이 기존 값과 같으면 비활성화된다', () => {
    render(<TimeWindows />);

    const startInput = screen.getByRole('textbox', { name: 'BUY 슬롯 1 시작 시간' });
    const saveButton = screen.getAllByRole('button', { name: '저장' })[0];

    expect(saveButton).toBeDisabled();

    fireEvent.change(startInput, { target: { value: '09:01' } });
    expect(saveButton).not.toBeDisabled();

    fireEvent.change(startInput, { target: { value: '9:00' } });
    expect(saveButton).toBeDisabled();
  });
});
