import { BackupPanel } from '@renderer/features/backup-restore';
import { CredentialsSettingsPanel } from '@renderer/features/credentials-settings';
import {
  ChartSettingsForm,
  GridDensityForm,
  useDisplaySettings,
} from '@renderer/features/display-settings';
import {
  StrategySettingsSurface,
  type StrategySettingsTab,
} from '@renderer/features/edit-strategy';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { ErrorBoundary } from '@renderer/shared/ui';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';

/**
 * 설정 페이지.
 * - 기본 자동매매 설정 + 계좌 공통 보호 설정 포함.
 * - 각 섹션은 ErrorBoundary 로 격리해 한 폼이 throw 해도 다른 섹션은 계속 사용 가능하도록 한다 (흰화면 방지).
 */
export const SettingsPage = (): ReactElement => {
  return (
    <div style={{ display: 'grid', gap: '1.2rem', minWidth: 0 }}>
      <Section name="기본 자동매매 설정">
        <StrategySection />
      </Section>
      <Section name="표시 설정">
        <DisplaySettingsSection />
      </Section>
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
      <Section name="보안 · 자격증명">
        <CredentialsSettingsPanel />
      </Section>
    </div>
  );
};

function Section({ name, children }: { name: string; children: ReactNode }): ReactElement {
  return <ErrorBoundary name={name}>{children}</ErrorBoundary>;
}

/**
 * 기본 자동매매 설정 섹션.
 * - 전역 프리셋(pdno=null) 편집.
 * - presetKey 로 form 강제 재마운트 — sub-hook stale 방지 (검증된 패턴).
 */
function StrategySection(): ReactElement {
  const [tab, setTab] = useState<StrategySettingsTab>('basic');

  return (
    <div className="panel">
      <div className="panel__body">
        <StrategySettingsSurface activeTab={tab} onTabChange={setTab} />
      </div>
    </div>
  );
}

function DisplaySettingsSection(): ReactElement {
  const display = useDisplaySettings();

  if (display.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">표시 설정 로드 중…</div>
      </div>
    );
  }

  if (display.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{display.error.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">차트 표시</div>
        <div className="panel__body">
          <ChartSettingsForm
            resolvedMa={display.resolvedMa}
            resolvedVolume={display.resolvedVolume}
            resolvedCrosshair={display.resolvedCrosshair}
            isSaving={display.isSaving}
            onMaChange={display.setMaField}
            onVolumeChange={(field, value) => {
              display.setVolumeField(
                field as 'upColor' | 'downColor' | 'heightPercent',
                value as never,
              );
            }}
            onCrosshairChange={(field, value) => {
              display.setCrosshairField(field as 'mode' | 'labelVisible', value as never);
            }}
            onSave={display.handleSave}
            onReset={display.handleReset}
          />
        </div>
      </div>
      <div className="panel">
        <div className="panel__title">그리드 표시</div>
        <div className="panel__body">
          <GridDensityForm
            rowHeightPx={display.resolvedRowHeight}
            isSaving={display.isSaving}
            onChange={display.setRowHeight}
            onSave={display.handleSave}
            onReset={display.handleReset}
          />
        </div>
      </div>
    </div>
  );
}
