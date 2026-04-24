import type { ReactElement } from 'react';
import { formatSnapshotsText } from '../model/format-snapshot-text';
import { useLotLog } from '../model/use-lots-log';
import { useLotsLogEditMode } from '../model/use-lots-log-edit-mode';
import { LotsDateSidebar } from './lots-date-sidebar';
import { LotsEditPanel } from './lots-edit-panel';
import { LotsLogToolbar } from './lots-log-toolbar';
import { LotsSnapshotTable } from './lots-snapshot-table';

export const LotsLogPage = (): ReactElement => {
  const lotLog = useLotLog();
  const editMode = useLotsLogEditMode();

  const handleCopyAll = (): void => {
    if (!lotLog.selectedDate) return;
    const text = formatSnapshotsText(lotLog.selectedDate, lotLog.snapshots);
    void navigator.clipboard.writeText(text);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <LotsDateSidebar
        dates={lotLog.dates}
        datesLoading={lotLog.datesLoading}
        onSelectDate={lotLog.selectDate}
        selectedDate={lotLog.selectedDate}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <LotsLogToolbar
          accountId={editMode.accountId}
          editBusy={editMode.editLots.busy}
          editMode={editMode.editLots.mode}
          masterSafetyOn={editMode.masterSafetyOn}
          onCopyAll={handleCopyAll}
          onEnterMode={editMode.onEnterMode}
          onExitMode={editMode.editLots.exitMode}
          search={lotLog.search}
          setSearch={lotLog.setSearch}
          snapshotsCount={lotLog.snapshots.length}
        />
        <LotsEditPanel
          accountId={editMode.accountId}
          csvOpen={editMode.csvOpen}
          editLots={editMode.editLots}
          editPdnoInput={editMode.editPdnoInput}
          onEditPdnoInputChange={editMode.onEditPdnoInputChange}
          setCsvOpen={editMode.setCsvOpen}
        />
        <LotsSnapshotTable
          selectedDate={lotLog.selectedDate}
          snapshots={lotLog.snapshots}
          snapshotsLoading={lotLog.snapshotsLoading}
        />
      </div>
    </div>
  );
};
