import { BackupPanel } from '@renderer/features/backup-restore';
import { CredentialsSettingsPanel } from '@renderer/features/credentials-settings';
import {
  ChartSettingsForm,
  GridDensityForm,
  useDisplaySettings,
} from '@renderer/features/display-settings';
import {
  ProtectionLimits,
  RateGuard,
  StrategyForm,
  TimeWindows,
  useEditStrategy,
} from '@renderer/features/edit-strategy';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { Button, ErrorBoundary, Select } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
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
function presetKey(override: StrategyProfile | null, active: StrategyProfile | null): string {
  return JSON.stringify(override ?? active ?? {});
}

function StrategySection(): ReactElement {
  const strategy = useEditStrategy(null);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [initialOverride, setInitialOverride] = useState<StrategyProfile | null>(null);

  if (strategy.active.isPending || strategy.presets.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">설정 로드 중…</div>
      </div>
    );
  }
  if (strategy.active.error || strategy.presets.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">
            {strategy.active.error?.message ?? strategy.presets.error?.message}
          </span>
        </div>
      </div>
    );
  }

  const presets: Array<{ name: string; profile: StrategyProfile }> =
    strategy.presets.data?.presets ?? [];
  const applyPreset = (name: string): void => {
    setSelectedPreset(name);
    const preset = presets.find((p) => p.name === name);
    if (preset) setInitialOverride(preset.profile);
  };

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">프리셋</div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Select
            id="settings-strategy-preset-select"
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
            aria-label="프리셋 선택"
            disabled={strategy.isPending || presets.length === 0}
            dense
            style={{ width: 'auto', minWidth: '18rem' }}
          >
            <option value="">— 프리셋 선택 —</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => {
              if (selectedPreset) strategy.removePreset(selectedPreset);
              setSelectedPreset('');
            }}
            disabled={!selectedPreset || strategy.isPending}
            dense
          >
            프리셋 삭제
          </Button>
          {presets.length === 0 ? <span className="muted">저장된 프리셋이 없습니다.</span> : null}
        </div>
      </div>

      <StrategyForm
        key={presetKey(initialOverride, strategy.active.data?.profile ?? null)}
        initial={initialOverride ?? strategy.active.data?.profile ?? null}
        disabled={strategy.isPending}
        onSubmit={(profile) => {
          void strategy.save(profile);
          setInitialOverride(null);
        }}
        onSaveAsPreset={(name, profile) => {
          void strategy.saveAsPreset(name, profile);
        }}
      />

      <div className="panel">
        <div className="panel__title">계좌 공통 보호 설정</div>
        <div className="panel__body" style={{ display: 'grid', gap: '1rem' }}>
          <ProtectionLimits />
          <TimeWindows />
          <RateGuard />
        </div>
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
