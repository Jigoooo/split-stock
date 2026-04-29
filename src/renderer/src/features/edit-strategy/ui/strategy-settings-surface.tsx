import {
  alertDialog,
  Button,
  DialogType,
  type HtsTabItem,
  HtsTabs,
  Select,
  TextInput,
} from '@renderer/shared/ui';
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
      submitContextLabel="기본값"
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
  const [newTemplateName, setNewTemplateName] = useState('');

  const presets = useMemo(
    () => strategy.presets.data?.presets ?? [],
    [strategy.presets.data?.presets],
  );
  const selectedPreset = presets.find((preset) => preset.name === selectedTemplate) ?? null;
  const initial = draftOverride ?? selectedPreset?.profile ?? strategy.active.data?.profile ?? null;
  const isEditingExisting = selectedTemplate.length > 0;
  const trimmedNewTemplateName = newTemplateName.trim();

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
            setNewTemplateName('');
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
            setNewTemplateName('');
          }}
          disabled={strategy.isPending}
          dense
        >
          새로 추가
        </Button>
        <Button
          onClick={() => {
            if (!selectedTemplate) return;
            void (async () => {
              const confirmed = await alertDialog.confirm({
                type: DialogType.WARNING,
                title: '템플릿 삭제',
                message: `"${selectedTemplate}" 템플릿을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
                confirmText: '삭제',
                cancelText: '취소',
              });
              if (!confirmed) return;
              await strategy.removePreset(selectedTemplate);
              setSelectedTemplate('');
              setDraftOverride(null);
            })();
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

      {isEditingExisting ? (
        <div className="chip" style={{ justifySelf: 'start' }}>
          편집 중 · {selectedTemplate}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '0.8rem',
            border: '0.1rem solid var(--border)',
            borderRadius: '0.6rem',
            background: 'var(--bg-2, rgba(0,0,0,0.03))',
          }}
        >
          <div style={{ display: 'grid', gap: '0.2rem', minWidth: '12rem' }}>
            <strong style={{ color: 'var(--fg)' }}>새 템플릿 작성</strong>
            <span className="muted" style={{ fontSize: '0.95rem' }}>
              이름을 입력하면 하단 저장 버튼으로 템플릿을 생성합니다.
            </span>
          </div>
          <TextInput
            id="strategy-template-new-name"
            value={newTemplateName}
            onChange={(event) => setNewTemplateName(event.target.value)}
            placeholder="템플릿 이름"
            aria-label="새 템플릿 이름"
            disabled={strategy.isPending}
            dense
            style={{ flex: '1 1 16rem', minWidth: '14rem' }}
          />
        </div>
      )}

      <StrategyForm
        key={`${selectedTemplate || 'new'}:${profileKey(initial)}`}
        initial={initial}
        disabled={strategy.isPending}
        chrome="content"
        submitLabel={isEditingExisting ? '템플릿 덮어쓰기' : '템플릿 저장'}
        submitContextLabel="템플릿"
        submitDisabled={isEditingExisting ? !selectedTemplate : trimmedNewTemplateName.length === 0}
        submitRequiresDirty={isEditingExisting}
        onSubmit={(profile) => {
          if (isEditingExisting) {
            void (async () => {
              const confirmed = await alertDialog.confirm({
                type: DialogType.WARNING,
                title: '템플릿 덮어쓰기',
                message: `"${selectedTemplate}" 템플릿을 현재 차수 설정으로 덮어씁니다.`,
                confirmText: '덮어쓰기',
                cancelText: '취소',
              });
              if (!confirmed) return;
              await strategy.saveAsPreset(selectedTemplate, profile);
            })();
            return;
          }
          if (trimmedNewTemplateName.length === 0) return;
          void strategy.saveAsPreset(trimmedNewTemplateName, profile);
          setSelectedTemplate(trimmedNewTemplateName);
          setNewTemplateName('');
          setDraftOverride(profile);
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
