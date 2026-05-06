// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseActiveAccountId = vi.hoisted(() => vi.fn());
const mockMutation = vi.hoisted(() => () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  error: null,
}));
const cryptoProfile = vi.hoisted(() => ({
  version: 1,
  market: 'KRW-BTC',
  maxStages: 2,
  buyRules: [
    { nth: 1, triggerDropPct: null, amountKrw: '5000' },
    { nth: 2, triggerDropPct: '0.03', amountKrw: '5000' },
  ],
  sellRules: [
    { nth: 1, targetProfitPct: '0.02' },
    { nth: 2, targetProfitPct: '0.02' },
  ],
  autoBuyEnabled: false,
  autoBuyOrderType: 'MARKET',
  autoSellEnabled: false,
  autoSellOrderType: 'MARKET',
}));

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
  isCryptoAccount: (account: { broker?: string | null } | null | undefined) =>
    account != null && account.broker === 'UPBIT',
  isDomesticAccount: (account: { broker?: string | null } | null | undefined) =>
    account != null && (account.broker === 'KIS' || account.broker === 'KIWOOM'),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    useUtils: () => ({
      crypto: {
        getAutoStatus: { invalidate: vi.fn() },
        getAutoStrategy: { invalidate: vi.fn() },
        listAutoStrategyTemplates: { invalidate: vi.fn() },
      },
    }),
    auth: {
      getEnv: { useQuery: () => ({ data: { env: 'PROD' }, isPending: false }) },
    },
    crypto: {
      listMarkets: {
        useQuery: () => ({
          data: { entries: [{ market: 'KRW-BTC', koreanName: '비트코인' }] },
          isPending: false,
        }),
      },
      getAutoStrategy: {
        useQuery: () => ({
          data: { profile: cryptoProfile },
          isFetching: false,
        }),
      },
      getAutoStatus: {
        useQuery: () => ({
          data: {
            config: {
              emergencyDisabled: true,
              maxOrderKrw: '5000',
              maxTotalExposureKrw: '50000',
            },
          },
          isFetching: false,
        }),
      },
      listAutoStrategyTemplates: { useQuery: () => ({ data: { templates: [] } }) },
      saveAutoStrategy: { useMutation: mockMutation },
      saveAutoConfig: { useMutation: mockMutation },
      saveAutoStrategyTemplate: { useMutation: mockMutation },
      deleteAutoStrategyTemplate: { useMutation: mockMutation },
    },
    fees: {
      getSettings: {
        useQuery: () => ({ data: { buy: 0.05, sell: 0.05, tax: 0 }, isPending: false }),
      },
      updateSettings: { useMutation: mockMutation },
    },
  },
}));

vi.mock('@renderer/features/backup-restore', () => ({
  BackupPanel: () => <div data-testid="backup-panel" />,
}));

vi.mock('./ui/credentials-settings-panel', () => ({
  CredentialsSettingsPanel: () => <div data-testid="credentials-panel" />,
}));

vi.mock('@renderer/features/display-settings', () => ({
  ChartSettingsForm: () => <div data-testid="chart-settings-form" />,
  GridDensityForm: () => <div data-testid="grid-density-form" />,
  useDisplaySettings: () => ({
    isPending: false,
    error: null,
    isSaving: false,
    isChartDirty: false,
    isGridDirty: false,
    resolvedMa: vi.fn(),
    resolvedVolume: {},
    resolvedCrosshair: {},
    resolvedRowHeight: 26,
    setMaField: vi.fn(),
    setVolumeField: vi.fn(),
    setCrosshairField: vi.fn(),
    setRowHeight: vi.fn(),
    handleSave: vi.fn(),
    handleReset: vi.fn(),
  }),
}));

vi.mock('@renderer/features/edit-strategy', () => ({
  StrategySettingsSurface: () => <div data-testid="strategy-settings-surface" />,
  STRATEGY_SETTINGS_TABS: [
    { id: 'basic', label: '기본매매 설정' },
    { id: 'templates', label: '템플릿 관리' },
    { id: 'protection', label: '보호 설정' },
    { id: 'conditions', label: '조건 설정' },
  ],
}));

vi.mock('@renderer/features/pending-cancel-settings', () => ({
  ActivePendingList: () => <div data-testid="active-pending-list" />,
  PendingCancelForm: () => <div data-testid="pending-cancel-form" />,
}));

vi.mock('@renderer/features/price-correction-settings', () => ({
  PriceCorrectionForm: () => <div data-testid="price-correction-form" />,
}));

import { SettingsPage } from './ui/settings-page';

function expectTabSelected(name: string): void {
  expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

describe('SettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseActiveAccountId.mockReset();
    mockUseActiveAccountId.mockReturnValue({
      accountId: 1,
      account: { broker: 'KIS' },
      isPending: false,
    });
  });

  it('상위 설정 탭으로 섹션을 분리한다', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('strategy-settings-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-settings-form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '표시' }));

    expect(screen.getByTestId('chart-settings-form')).toBeInTheDocument();
    expect(screen.getByTestId('grid-density-form')).toBeInTheDocument();
    expect(screen.queryByTestId('strategy-settings-surface')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '주문/체결' }));

    expect(screen.getByTestId('pending-cancel-form')).toBeInTheDocument();
    expect(screen.getByTestId('active-pending-list')).toBeInTheDocument();
    expect(screen.getByTestId('price-correction-form')).toBeInTheDocument();
  });

  it('캐시된 설정 팝아웃을 target 없이 다시 열면 기본 매매설정으로 리셋한다', () => {
    const { rerender } = render(<SettingsPage activationKey={1} />);

    fireEvent.click(screen.getByRole('tab', { name: '표시' }));
    expect(screen.getByTestId('chart-settings-form')).toBeInTheDocument();

    rerender(<SettingsPage activationKey={2} />);

    expect(screen.getByTestId('strategy-settings-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-settings-form')).not.toBeInTheDocument();
    expectTabSelected('매매설정관리');
    expectTabSelected('기본매매 설정');
  });

  it('캐시된 설정 팝아웃을 chart target으로 다시 열면 표시 탭으로 이동한다', () => {
    const { rerender } = render(<SettingsPage activationKey={1} />);

    window.localStorage.setItem('popout:settings:initialTab', 'display');
    rerender(<SettingsPage activationKey={2} />);

    expect(screen.getByTestId('chart-settings-form')).toBeInTheDocument();
    expect(screen.getByTestId('grid-density-form')).toBeInTheDocument();
    expectTabSelected('표시');
    expect(window.localStorage.getItem('popout:settings:initialTab')).toBeNull();
  });

  it('캐시된 설정 팝아웃을 strategy template target으로 다시 열면 템플릿 관리로 이동한다', () => {
    const { rerender } = render(<SettingsPage activationKey={1} />);

    window.localStorage.setItem('popout:settings:initialTab', 'strategy');
    window.localStorage.setItem('popout:settings:strategyTab', 'templates');
    rerender(<SettingsPage activationKey={2} />);

    expect(screen.getByTestId('strategy-settings-surface')).toBeInTheDocument();
    expectTabSelected('매매설정관리');
    expectTabSelected('템플릿 관리');
    expect(window.localStorage.getItem('popout:settings:initialTab')).toBeNull();
    expect(window.localStorage.getItem('popout:settings:strategyTab')).toBeNull();
  });

  it('잘못된 cached target은 제거하고 기본 매매설정으로 fallback한다', () => {
    window.localStorage.setItem('popout:settings:initialTab', 'unknown');
    window.localStorage.setItem('popout:settings:strategyTab', 'unknown');

    render(<SettingsPage />);

    expect(screen.getByTestId('strategy-settings-surface')).toBeInTheDocument();
    expectTabSelected('매매설정관리');
    expectTabSelected('기본매매 설정');
    expect(window.localStorage.getItem('popout:settings:initialTab')).toBeNull();
    expect(window.localStorage.getItem('popout:settings:strategyTab')).toBeNull();
  });

  it('UPBIT 계좌에서는 코인 매매설정관리를 기본으로 열고 주문/체결 탭도 동등 노출한다', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 2,
      account: { broker: 'UPBIT' },
      isPending: false,
    });

    render(<SettingsPage />);

    expectTabSelected('매매설정관리');
    expectTabSelected('기본매매 설정');
    expect(screen.getByText(/코인 매매설정관리/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '템플릿 관리' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '보호 설정' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '조건 설정' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '수수료' })).toBeInTheDocument();
    // RALPLAN P6 #9 — 코인 계좌에도 '주문/체결' 탭 노출 (PendingCancelForm + CryptoActivePendingList).
    // 단, default 탭은 매매설정관리이므로 PendingCancelForm 자체는 아직 렌더되지 않음.
    expect(screen.getByRole('tab', { name: '주문/체결' })).toBeInTheDocument();
    expect(screen.queryByTestId('strategy-settings-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-cancel-form')).not.toBeInTheDocument();
  });
});
