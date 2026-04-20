import { StrategyForm, useEditStrategy } from '@renderer/features/edit-strategy';
import { Button, Select } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * 차수(전략) 설정 탭.
 * - 대시보드 페이지의 탭 중 하나로 임베드된다 (settings 페이지에서 분리 이동).
 * - 프리셋 선택 + StrategyForm 편집/저장.
 *
 * 주의: StrategyForm 의 sub-hook 들이 props.initial 변경 시 stale 이 되는 것을 막기 위해
 * presetKey 로 form 을 강제 재마운트한다 (settings-page 에서 검증된 패턴).
 */
function presetKey(override: StrategyProfile | null, active: StrategyProfile | null): string {
  return JSON.stringify(override ?? active ?? {});
}

export const StrategyTab = (): ReactElement => {
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
            id="dashboard-strategy-preset-select"
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
    </div>
  );
};
