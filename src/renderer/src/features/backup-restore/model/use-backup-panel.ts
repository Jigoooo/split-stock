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
