import { BackupPanel } from '@renderer/features/backup-restore';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { ErrorBoundary } from '@renderer/shared/ui';
import type { ReactElement, ReactNode } from 'react';

/**
 * 설정 페이지.
 * - 차수(전략) 파라미터 편집은 대시보드 탭으로 이동했다 — 여기는 시스템 / 보호 / 백업 등 전역 설정만 다룬다.
 * - 각 섹션은 ErrorBoundary 로 격리해 한 폼이 throw 해도 다른 섹션은 계속 사용 가능하도록 한다 (흰화면 방지).
 */
export const SettingsPage = (): ReactElement => {
  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <Section name="미체결 자동취소">
        <PendingCancelForm />
      </Section>
      <Section name="활성 미체결 목록">
        <ActivePendingList />
      </Section>
      <Section name="호가 자동 보정">
        <div className="panel">
          <div className="panel__title">호가 자동 보정</div>
          <div className="panel__body">
            <PriceCorrectionForm />
          </div>
        </div>
      </Section>
      <Section name="백업/복원">
        <BackupPanel />
      </Section>
    </div>
  );
};

function Section({ name, children }: { name: string; children: ReactNode }): ReactElement {
  return <ErrorBoundary name={name}>{children}</ErrorBoundary>;
}
