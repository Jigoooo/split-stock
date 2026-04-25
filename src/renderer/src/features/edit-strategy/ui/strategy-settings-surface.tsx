import { Button, type HtsTabItem, HtsTabs, Select } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useEditStrategy } from '../model/use-edit-strategy';
import { ProtectionLimits } from './protection-limits';
import { RateGuard } from './rate-guard';
import { StrategyForm } from './strategy-form';
import { TimeWindows } from './time-windows';

// `as const satisfies` 로 라벨 정의와 id 유니온 타입을 한 곳에서 동기화.
// → StrategySettingsTab 은 STRATEGY_SETTINGS_TABS 배열의 id 유니온으로 자동 derive.
export const STRATEGY_SETTINGS_TABS = [
  { id: 'basic', label: '기본매매 설정' },
  { id: 'templates', label: '템플릿 관리' },
  { id: 'protection', label: '보호 설정' },
  { id: 'conditions', label: '조건 설정' },
] as const satisfies ReadonlyArray<HtsTabItem<string>>;

export type StrategySettingsTab = (typeof STRATEGY_SETTINGS_TABS)[number]['id'];

export interface StrategySettingsSurfaceProps {
  activeTab: StrategySettingsTab;
  onTabChange: (tab: StrategySettingsTab) => void;
  /** true 면 탭 헤더를 surface 내부에 렌더하지 않음 — 부모가 외부에 sticky 로 띄울 때 사용. */
  hideTabs?: boolean;
}

function profileKey(profile: StrategyProfile | null | undefined): string {
  return JSON.stringify(profile ?? {});
}

export const StrategySettingsSurface = ({
  activeTab,
  onTabChange,
  hideTabs = false,
}: StrategySettingsSurfaceProps): ReactElement => {
  return (
    <div style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
      {hideTabs ? null : (
        <HtsTabs
          tabs={STRATEGY_SETTINGS_TABS}
          active={activeTab}
          onChange={onTabChange}
          ariaLabel="기본 자동매매설정 탭"
        />
      )}
      {activeTab === 'basic' ? <DefaultStrategyPanel /> : null}
      {activeTab === 'templates' ? <TemplateManagementPanel /> : null}
      {activeTab === 'protection' ? <ProtectionSettingsPanel /> : null}
      {activeTab === 'conditions' ? <ConditionSettingsPanel /> : null}
    </div>
  );
};

function DefaultStrategyPanel(): ReactElement {
  const strategy = useEditStrategy(null);

  if (strategy.active.isPending) {
    return <div className="muted">기본 자동매매 설정 로드 중…</div>;
  }
  if (strategy.active.error) {
    return <span className="chip chip--down">{strategy.active.error.message}</span>;
  }

  return (
    <StrategyForm
      key={profileKey(strategy.active.data?.profile)}
      initial={strategy.active.data?.profile ?? null}
      disabled={strategy.isPending}
      chrome="content"
      submitLabel="기본값 저장"
      onSubmit={(profile) => {
        void strategy.save(profile);
      }}
    />
  );
}

function TemplateManagementPanel(): ReactElement {
  const strategy = useEditStrategy(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [draftOverride, setDraftOverride] = useState<StrategyProfile | null>(null);

  const presets = useMemo(
    () => strategy.presets.data?.presets ?? [],
    [strategy.presets.data?.presets],
  );
  const selectedPreset = presets.find((preset) => preset.name === selectedTemplate) ?? null;
  const initial = draftOverride ?? selectedPreset?.profile ?? strategy.active.data?.profile ?? null;

  if (strategy.active.isPending || strategy.presets.isPending) {
    return <div className="muted">템플릿 로드 중…</div>;
  }
  if (strategy.active.error || strategy.presets.error) {
    return (
      <span className="chip chip--down">
        {strategy.active.error?.message ?? strategy.presets.error?.message}
      </span>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          id="strategy-template-select"
          value={selectedTemplate}
          onChange={(event) => {
            const name = event.target.value;
            setSelectedTemplate(name);
            setDraftOverride(null);
          }}
          aria-label="템플릿 선택"
          disabled={strategy.isPending || presets.length === 0}
          dense
          style={{ minWidth: '18rem' }}
        >
          <option value="">템플릿 선택</option>
          {presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </Select>
        <Button
          onClick={() => {
            setSelectedTemplate('');
            setDraftOverride(strategy.active.data?.profile ?? null);
          }}
          disabled={strategy.isPending}
          dense
        >
          새로 추가
        </Button>
        <Button
          onClick={() => {
            if (selectedTemplate) void strategy.removePreset(selectedTemplate);
            setSelectedTemplate('');
            setDraftOverride(null);
          }}
          disabled={!selectedTemplate || strategy.isPending}
          dense
        >
          템플릿 삭제
        </Button>
        {presets.length === 0 ? (
          <span className="muted">저장된 템플릿이 없습니다. 새로 추가해서 생성할 수 있습니다.</span>
        ) : null}
      </div>

      <StrategyForm
        key={`${selectedTemplate}:${profileKey(initial)}`}
        initial={initial}
        disabled={strategy.isPending}
        chrome="content"
        submitLabel="템플릿 덮어쓰기"
        submitDisabled={!selectedTemplate}
        onSubmit={(profile) => {
          if (!selectedTemplate) return;
          void strategy.saveAsPreset(selectedTemplate, profile);
        }}
        onSaveAsPreset={(name, profile) => {
          void strategy.saveAsPreset(name, profile);
          setSelectedTemplate(name);
          setDraftOverride(null);
        }}
      />
    </div>
  );
}

function ProtectionSettingsPanel(): ReactElement {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <ProtectionLimits />
      <RateGuard />
    </div>
  );
}

function ConditionSettingsPanel(): ReactElement {
  return <TimeWindows />;
}
