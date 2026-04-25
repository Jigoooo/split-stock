import { trpc } from '@renderer/shared/api/trpc';
import { useState } from 'react';

export function useBackupPanel() {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);

  const exportMutation = trpc.backup.exportDatabase.useMutation({
    onSuccess: (result) => {
      if (result.canceled) return;
      setMessage(`백업 완료: ${result.filename} (${result.sha256.slice(0, 12)}…)`);
    },
    onError: (error) => setMessage(`백업 실패: ${error.message}`),
  });

  const importMutation = trpc.backup.importDatabase.useMutation({
    onSuccess: async (result) => {
      if (result.canceled) return;
      setMessage(
        `복원 완료 — 기존 DB는 ${result.backupBeforeRestore}로 대피. credentials 재입력이 필요합니다.`,
      );
      await utils.backup.needsCredentialsReentry.invalidate();
    },
    onError: (error) => setMessage(`복원 실패: ${error.message}`),
  });

  return {
    message,
    exportPending: exportMutation.isPending,
    importPending: importMutation.isPending,
    clearMessage: () => setMessage(null),
    exportDatabase: () => exportMutation.mutate(),
    importDatabase: () => importMutation.mutate(),
  };
}

export interface UseAutoBackupSettingsResult {
  isPending: boolean;
  isSaving: boolean;
  error: { message: string } | null;
  enabled: boolean;
  retentionDays: number;
  scheduledTimes: ReadonlyArray<string>;
  isDirty: boolean;
  setEnabled: (v: boolean) => void;
  setRetentionDays: (v: number) => void;
  save: () => void;
  reset: () => void;
}

interface AutoBackupForm {
  enabled: boolean;
  retentionDays: number;
}

export function useAutoBackupSettings(): UseAutoBackupSettingsResult {
  const query = trpc.backup.getAutoBackupSettings.useQuery();
  const utils = trpc.useUtils();

  const serverForm: AutoBackupForm = query.data
    ? { enabled: query.data.enabled, retentionDays: query.data.retentionDays }
    : { enabled: true, retentionDays: 10 };

  const [localForm, setLocalForm] = useState<AutoBackupForm | null>(null);
  const form = localForm ?? serverForm;

  const updateMutation = trpc.backup.setAutoBackupSettings.useMutation({
    onSuccess: () => {
      void utils.backup.getAutoBackupSettings.invalidate();
      setLocalForm(null);
    },
  });

  const isDirty = localForm !== null && JSON.stringify(localForm) !== JSON.stringify(serverForm);

  const patch = (partial: Partial<AutoBackupForm>): void => {
    setLocalForm((prev) => ({ ...(prev ?? serverForm), ...partial }));
  };

  return {
    isPending: query.isPending,
    isSaving: updateMutation.isPending,
    error: query.error
      ? { message: query.error.message }
      : updateMutation.error
        ? { message: updateMutation.error.message }
        : null,
    enabled: form.enabled,
    retentionDays: form.retentionDays,
    scheduledTimes: query.data?.scheduledTimes ?? ['12:30', '15:20'],
    isDirty,
    setEnabled: (v) => patch({ enabled: v }),
    setRetentionDays: (v) => patch({ retentionDays: v }),
    save: () => {
      updateMutation.mutate(form);
    },
    reset: () => setLocalForm(null),
  };
}
