// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseActiveAccountId = vi.hoisted(() => vi.fn());

vi.mock('@renderer/entities/account', () => ({
  useActiveAccountId: () => mockUseActiveAccountId(),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    auth: {
      getEnv: { useQuery: () => ({ data: { env: 'PROD' }, isPending: false }) },
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

  it('UPBIT 계좌에서는 국내주식 설정 탭을 숨기고 코인 설정 탭을 기본으로 연다', () => {
    mockUseActiveAccountId.mockReturnValue({
      accountId: 2,
      account: { broker: 'UPBIT' },
      isPending: false,
    });

    render(<SettingsPage />);

    expectTabSelected('코인');
    expect(screen.getByText('코인 거래 설정')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '매매설정관리' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '주문/체결' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('strategy-settings-surface')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pending-cancel-form')).not.toBeInTheDocument();
  });
});
