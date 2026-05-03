import { Button, SegmentedToggle, Select, TextInput } from '@renderer/shared/ui';
import type {
  CryptoAutoGateResult,
  CryptoAutoTemplate,
  CryptoStrategyProfile,
} from '@shared/contracts';
import { type ReactElement, useState } from 'react';
import { CryptoStrategyForm } from './crypto-strategy-form';

type AutoMode = 'disabled' | 'dry-run' | 'live-small';

export const CryptoAutoStrategyTabBody = ({
  gate,
  market,
  mode,
  onDeleteTemplate,
  onModeChange,
  onSaveTemplate,
  onStrategySave,
  pending,
  strategy,
  strategyLoading,
  templates,
}: {
  gate: CryptoAutoGateResult;
  market: string;
  mode: AutoMode;
  onDeleteTemplate: (id: number) => void;
  onModeChange: (mode: AutoMode) => void;
  onSaveTemplate: (name: string, profile: CryptoStrategyProfile) => void;
  onStrategySave: (profile: CryptoStrategyProfile) => void;
  pending: boolean;
  strategy: CryptoStrategyProfile;
  strategyLoading: boolean;
  templates: CryptoAutoTemplate[];
}): ReactElement => {
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('기본 코인 차수 전략');
  const selectedTemplate = templates.find((template) => String(template.id) === templateId) ?? null;

  return (
    <div className="crypto-auto-strategy-tab">
      <fieldset className="panel crypto-auto-template-bar">
        <legend className="sr-only">코인 자동매매 템플릿</legend>
        <Select
          aria-label="코인 자동매매 템플릿 선택"
          dense
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">템플릿 선택</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <TextInput
          aria-label="코인 자동매매 템플릿 이름"
          dense
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
        />
        <Button
          dense
          disabled={!selectedTemplate || pending}
          onClick={() => {
            if (selectedTemplate) onStrategySave(selectedTemplate.strategy);
          }}
        >
          불러오기
        </Button>
        <Button
          dense
          disabled={pending || templateName.trim().length === 0}
          onClick={() => onSaveTemplate(templateName.trim(), strategy)}
        >
          저장
        </Button>
        <Button
          dense
          variant="destructive"
          disabled={!selectedTemplate || pending}
          onClick={() => {
            if (selectedTemplate) onDeleteTemplate(selectedTemplate.id);
          }}
        >
          삭제
        </Button>
      </fieldset>
      <CryptoAutoPanel
        enabled={market.startsWith('KRW-')}
        gate={gate}
        mode={mode}
        onModeChange={onModeChange}
        onStrategySave={onStrategySave}
        pending={pending}
        strategy={strategy}
        strategyLoading={strategyLoading}
      />
    </div>
  );
};

export const CryptoAutoPanel = ({
  enabled,
  gate,
  mode,
  onModeChange,
  onStrategySave,
  pending,
  strategy,
  strategyLoading,
}: {
  enabled: boolean;
  gate: CryptoAutoGateResult;
  mode: AutoMode;
  onModeChange: (mode: AutoMode) => void;
  onStrategySave: (profile: CryptoStrategyProfile) => void;
  pending: boolean;
  strategy: CryptoStrategyProfile;
  strategyLoading: boolean;
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-auto-panel">
    <div className="panel__title">자동감시</div>
    {!enabled ? (
      <div className="panel__body muted">Upbit KRW 실전 계좌와 KRW 마켓에서만 동작합니다.</div>
    ) : (
      <div className="panel__body crypto-auto-panel__body">
        <div className="crypto-auto-panel__controls">
          <SegmentedToggle
            ariaLabel="코인 자동감시 모드"
            value={mode === 'dry-run' ? 'disabled' : mode}
            onChange={onModeChange}
            dense
            items={[
              { value: 'disabled', label: '중지' },
              { value: 'live-small', label: '소액 실거래' },
            ]}
          />
        </div>
        {strategyLoading ? <span className="muted">차수 전략 로드 중…</span> : null}
        <CryptoStrategyForm
          disabled={pending}
          profile={strategy}
          onSubmit={onStrategySave}
          chrome="content"
          submitLabel="종목 설정 저장"
          submitAriaLabel="코인 종목 설정 저장"
        />
        {gate.blockedReasons.length > 0 ? (
          <div className="crypto-auto-panel__reasons">
            {gate.blockedReasons.map((reason) => (
              <span key={reason} className="chip chip--down">
                {reason}
              </span>
            ))}
          </div>
        ) : null}
        <p className="muted crypto-auto-panel__advanced-hint">
          보호 설정·소액 실거래·루프 컨트롤은 설정 → 고급/안전 탭으로 이동했습니다.
        </p>
      </div>
    )}
  </section>
);
