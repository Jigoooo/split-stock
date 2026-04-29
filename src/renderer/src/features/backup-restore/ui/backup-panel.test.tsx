// @vitest-environment jsdom
import { alertDialog } from '@renderer/shared/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearMessageMock = vi.fn();
const exportDatabaseMock = vi.fn();
const importDatabaseMock = vi.fn();
const useBackupPanelMock = vi.fn(() => ({
  clearMessage: clearMessageMock,
  exportDatabase: exportDatabaseMock,
  exportPending: false,
  importDatabase: importDatabaseMock,
  importPending: false,
  message: null,
}));

vi.mock('../model/use-backup-panel', () => ({
  useBackupPanel: () => useBackupPanelMock(),
  useAutoBackupSettings: () => ({
    isPending: false,
    isSaving: false,
    error: null,
    enabled: true,
    retentionDays: 10,
    scheduledTimes: ['12:30', '15:20'] as const,
    isDirty: false,
    setEnabled: () => {},
    setRetentionDays: () => {},
    save: () => {},
    reset: () => {},
  }),
}));

vi.mock('./duplicate-path-form', () => ({
  DuplicatePathForm: () => null,
}));

import { BackupPanel } from './backup-panel';

describe('BackupPanel', () => {
  beforeEach(() => {
    clearMessageMock.mockClear();
    exportDatabaseMock.mockClear();
    importDatabaseMock.mockClear();
  });

  it('DB 내보내기는 바로 실행한다', () => {
    render(<BackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'DB 내보내기' }));

    expect(clearMessageMock).toHaveBeenCalled();
    expect(exportDatabaseMock).toHaveBeenCalled();
  });

  it('DB 복원은 confirm 통과 후에만 실행한다', async () => {
    const confirmSpy = vi.spyOn(alertDialog, 'confirm').mockResolvedValue(true);
    render(<BackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'DB 복원' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await waitFor(() => expect(clearMessageMock).toHaveBeenCalled());
    expect(importDatabaseMock).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('DB 복원 confirm이 취소되면 실행하지 않는다', async () => {
    const confirmSpy = vi.spyOn(alertDialog, 'confirm').mockResolvedValue(false);
    render(<BackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'DB 복원' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(importDatabaseMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
