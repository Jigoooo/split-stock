// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './ui/settings-page';

vi.mock('@renderer/features/backup-restore', () => ({
  BackupPanel: () => <div data-testid="backup-panel" />,
}));

vi.mock('@renderer/features/credentials-settings', () => ({
  CredentialsSettingsPanel: () => <div data-testid="credentials-panel" />,
}));

vi.mock('@renderer/features/display-settings', () => ({
  ChartSettingsForm: () => <div data-testid="chart-settings-form" />,
  GridDensityForm: () => <div data-testid="grid-density-form" />,
  useDisplaySettings: () => ({
    isPending: false,
    error: null,
    isSaving: false,
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
}));

vi.mock('@renderer/features/pending-cancel-settings', () => ({
  ActivePendingList: () => <div data-testid="active-pending-list" />,
  PendingCancelForm: () => <div data-testid="pending-cancel-form" />,
}));

vi.mock('@renderer/features/price-correction-settings', () => ({
  PriceCorrectionForm: () => <div data-testid="price-correction-form" />,
}));

describe('SettingsPage', () => {
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
});
