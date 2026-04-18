import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * DB 백업/복원 패널.
 * - 내보내기: 파일 dialog → 저장 + sha256 표시
 * - 가져오기: 파일 dialog → 기존 DB는 .backup-before-restore로 자동 대피
 * - 복원 후 credentials 재입력 배너(별도 컴포넌트)가 띄워짐
 */
export const BackupPanel = (): ReactElement => {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<string | null>(null);

  const exportMutation = trpc.backup.exportDatabase.useMutation({
    onSuccess: (r) => {
      if (r.canceled) return;
      setMessage(`백업 완료: ${r.filename} (${r.sha256.slice(0, 12)}…)`);
    },
    onError: (e) => setMessage(`백업 실패: ${e.message}`),
  });

  const importMutation = trpc.backup.importDatabase.useMutation({
    onSuccess: async (r) => {
      if (r.canceled) return;
      setMessage(
        `복원 완료 — 기존 DB는 ${r.backupBeforeRestore}로 대피. credentials 재입력이 필요합니다.`,
      );
      await utils.backup.needsCredentialsReentry.invalidate();
    },
    onError: (e) => setMessage(`복원 실패: ${e.message}`),
  });

  return (
    <div className="panel">
      <div className="panel__title">백업/복원</div>
      <div className="panel__body" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hts-btn"
          onClick={() => {
            setMessage(null);
            exportMutation.mutate();
          }}
          disabled={exportMutation.isPending}
        >
          DB 내보내기
        </button>
        <button
          type="button"
          className="hts-btn"
          onClick={() => {
            if (
              !window.confirm(
                '복원 시 현재 DB는 .backup-before-restore 파일로 자동 대피됩니다. 계속할까요?',
              )
            ) {
              return;
            }
            setMessage(null);
            importMutation.mutate();
          }}
          disabled={importMutation.isPending}
        >
          DB 복원
        </button>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          복원 후 credentials는 OS 사용자 키 변경으로 재입력이 필요할 수 있음
        </span>
      </div>
      {message ? (
        <div className="panel__body">
          <span className="chip">{message}</span>
        </div>
      ) : null}
    </div>
  );
};
