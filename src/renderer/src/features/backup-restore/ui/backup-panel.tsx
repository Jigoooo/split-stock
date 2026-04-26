import { alertDialog, Button, Checkbox, NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useAutoBackupSettings, useBackupPanel } from '../model/use-backup-panel';
import { DuplicatePathForm } from './duplicate-path-form';

/**
 * DB 백업/복원 패널.
 * - 수동: 내보내기 / 복원
 * - 자동: 토글 + 보관일수 + 2중 백업 외부 경로
 */
export const BackupPanel = (): ReactElement => {
  const { clearMessage, exportDatabase, exportPending, importDatabase, importPending, message } =
    useBackupPanel();

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      {/* 수동 백업/복원 */}
      <div className="panel">
        <div className="panel__title">DB 백업/복원</div>
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
              void (async () => {
                const confirmed = await alertDialog.confirm({
                  title: 'DB 복원',
                  message:
                    '복원 시 현재 DB는 .backup-before-restore 파일로 자동 대피됩니다. 계속할까요?',
                  confirmText: '복원',
                  cancelText: '취소',
                });
                if (!confirmed) return;
                clearMessage();
                importDatabase();
              })();
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

      {/* 자동 백업 */}
      <AutoBackupPanel />

      {/* 2중 백업 외부 경로 */}
      <div className="panel">
        <div className="panel__title">2중 백업 외부 경로</div>
        <div className="panel__body">
          <DuplicatePathForm />
        </div>
      </div>
    </div>
  );
};

function AutoBackupPanel(): ReactElement {
  const auto = useAutoBackupSettings();

  if (auto.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">자동 백업 설정 로드 중…</div>
      </div>
    );
  }

  if (auto.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{auto.error.message}</span>
        </div>
      </div>
    );
  }

  const disabled = auto.isSaving;

  return (
    <div className="panel">
      <div className="panel__title">자동 백업</div>
      <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
        {!auto.enabled ? (
          <span className="chip chip--down">
            ⚠ 자동 백업이 꺼져 있습니다. 데이터 손실에 주의하세요.
          </span>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <Checkbox
            id="auto-backup-enabled"
            label="자동 백업 사용"
            checked={auto.enabled}
            onChange={(e) => auto.setEnabled(e.target.checked)}
            disabled={disabled}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <label htmlFor="auto-backup-retention" style={{ minWidth: '9rem' }}>
            보관 일수
          </label>
          <NumberInput
            id="auto-backup-retention"
            value={String(auto.retentionDays)}
            disabled={disabled || !auto.enabled}
            onValueChange={(raw) => {
              const v = Number(raw);
              if (Number.isFinite(v) && v >= 1 && v <= 365) auto.setRetentionDays(Math.floor(v));
            }}
            style={{ width: '8rem' }}
            dense
          />
          <span className="muted">1~365일 · 권장 7~30일</span>
        </div>

        {auto.enabled ? (
          <div className="muted" style={{ fontSize: '0.85em' }}>
            다음 자동 백업 시각: {auto.scheduledTimes.join(' / ')} (매일 고정)
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Button variant="primary" disabled={disabled || !auto.isDirty} onClick={auto.save} dense>
            {auto.isSaving ? '저장 중…' : '저장'}
          </Button>
          <Button disabled={disabled || !auto.isDirty} onClick={auto.reset} dense>
            초기화
          </Button>
        </div>
      </div>
    </div>
  );
}
