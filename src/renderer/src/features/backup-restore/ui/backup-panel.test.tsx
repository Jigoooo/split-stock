// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('DB 복원은 confirm 통과 후에만 실행한다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'DB 복원' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(clearMessageMock).toHaveBeenCalled();
    expect(importDatabaseMock).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('DB 복원 confirm이 취소되면 실행하지 않는다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<BackupPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'DB 복원' }));

    expect(importDatabaseMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
