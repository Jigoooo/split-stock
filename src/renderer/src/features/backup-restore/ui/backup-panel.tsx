import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useBackupPanel } from '../model/use-backup-panel';

/**
 * DB 백업/복원 패널.
 * - 내보내기: 파일 dialog → 저장 + sha256 표시
 * - 가져오기: 파일 dialog → 기존 DB는 .backup-before-restore로 자동 대피
 * - 복원 후 credentials 재입력 배너(별도 컴포넌트)가 띄워짐
 */
export const BackupPanel = (): ReactElement => {
  const { clearMessage, exportDatabase, exportPending, importDatabase, importPending, message } =
    useBackupPanel();

  return (
    <div className="panel">
      <div className="panel__title">백업/복원</div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Button
          onClick={() => {
            clearMessage();
            exportDatabase();
          }}
          disabled={exportPending}
          dense
        >
          DB 내보내기
        </Button>
        <Button
          onClick={() => {
            if (
              !window.confirm(
                '복원 시 현재 DB는 .backup-before-restore 파일로 자동 대피됩니다. 계속할까요?',
              )
            ) {
              return;
            }
            clearMessage();
            importDatabase();
          }}
          disabled={importPending}
          dense
        >
          DB 복원
        </Button>
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
