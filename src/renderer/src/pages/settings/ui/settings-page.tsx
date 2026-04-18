import { StrategyForm, useEditStrategy } from '@renderer/features/edit-strategy';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';

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
          <select
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
            aria-label="프리셋 선택"
            disabled={strategy.isPending || presets.length === 0}
          >
            <option value="">— 프리셋 선택 —</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="hts-btn"
            onClick={() => {
              if (selectedPreset) strategy.removePreset(selectedPreset);
              setSelectedPreset('');
            }}
            disabled={!selectedPreset || strategy.isPending}
          >
            프리셋 삭제
          </button>
          {presets.length === 0 ? <span className="muted">저장된 프리셋이 없습니다.</span> : null}
        </div>
      </div>

      <StrategyForm
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
