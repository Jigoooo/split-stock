import { BackupPanel } from '@renderer/features/backup-restore';
import { StrategyForm, useEditStrategy } from '@renderer/features/edit-strategy';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { Button, Select } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * StrategyForm 의 `key` 계산 — initial 이 바뀌면 폼이 재마운트되어 sub-hook 들이
 * 새 initial 로 useState initializer 를 재실행한다.
 */
function presetKey(override: StrategyProfile | null, active: StrategyProfile | null): string {
  return JSON.stringify(override ?? active ?? {});
}

export const SettingsPage = (): ReactElement => {
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
            id="settings-preset-select"
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

      {/*
        key prop: initial 변경 시 폼 전체를 재마운트해 sub-hook(useStageGrid/useBoosterSection) 의
        useState initializer 가 다시 실행되도록 강제. 이 패턴이 가장 안전 (props.initial 변경 시
        sub-hook 내부 state 가 stale 인 React 19 룰 회피).
      */}
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

      <PendingCancelForm />
      <ActivePendingList />
      <div className="panel">
        <div className="panel__title">호가 자동 보정</div>
        <div className="panel__body">
          <PriceCorrectionForm />
        </div>
      </div>
      <BackupPanel />
    </div>
  );
};
