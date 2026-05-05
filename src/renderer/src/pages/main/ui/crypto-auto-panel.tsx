import { alertDialog, Button, DialogType, Select, TextInput } from '@renderer/shared/ui';
import type { CryptoAutoTemplate, CryptoStrategyProfile } from '@shared/contracts';
import { type ReactElement, useState } from 'react';
import { CryptoStrategyForm } from './crypto-strategy-form';

/**
 * 코인 자동매매 설정 탭 (main 우측 패널).
 *
 * 운영 컨트롤(mode toggle, 글로벌 ON/OFF/소액 실거래/비상중지 chips, 보호 설정·루프
 * 컨트롤 hint) 은 모두 설정 → 고급/안전 탭으로 이동했다 (P0 격리). 이 탭은
 * 종목별 strategy 입력만 담당. onOpenAdvancedSettings 가 주어지면 panel title
 * 옆에 "고급/안전 →" 빠른 진입 링크를 노출한다 (onboarding).
 */

const openAdvancedSettingsPopout = (): void => {
  try {
    window.localStorage.setItem('popout:settings:initialTab', 'advanced');
  } catch {
    // localStorage 차단 시 — settings 페이지가 default 탭으로 열림.
  }
  void window.appShell?.openPopout('settings');
};

const openTemplateManagementPopout = (): void => {
  try {
    window.localStorage.setItem('popout:settings:initialTab', 'strategy');
  } catch {
    // localStorage 차단 시 — settings 페이지가 default 탭으로 열림.
  }
  void window.appShell?.openPopout('settings');
};

export const CryptoAutoStrategyTabBody = ({
  market,
  onDeleteTemplate,
  onSaveTemplate,
  onStrategySave,
  pending,
  strategy,
  strategyLoading,
  templates,
}: {
  market: string;
  onDeleteTemplate: (id: number) => void;
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
      <div className="crypto-auto-template-bar" role="toolbar" aria-label="코인 자동매매 템플릿">
        <Select
          aria-label="불러올 코인 자동매매 템플릿 선택"
          dense
          value={templateId}
          disabled={pending || templates.length === 0}
          onChange={(event) => setTemplateId(event.target.value)}
          style={{ minWidth: '15rem' }}
        >
          <option value="">템플릿 선택</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
        <Button
          dense
          disabled={!selectedTemplate || pending}
          onClick={() => {
            if (selectedTemplate) onStrategySave(selectedTemplate.strategy);
          }}
        >
          불러오기
        </Button>
        <TextInput
          aria-label="새 코인 자동매매 템플릿 이름"
          placeholder="템플릿 이름"
          dense
          disabled={pending}
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          style={{ flex: '0 1 12rem', minWidth: '8rem' }}
        />
        <Button
          dense
          variant="primary"
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
            if (!selectedTemplate) return;
            void (async () => {
              const confirmed = await alertDialog.confirm({
                type: DialogType.WARNING,
                title: '템플릿 삭제',
                message: `"${selectedTemplate.name}" 템플릿을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
                confirmText: '삭제',
                cancelText: '취소',
              });
              if (!confirmed) return;
              onDeleteTemplate(selectedTemplate.id);
              setTemplateId('');
            })();
          }}
        >
          삭제
        </Button>
        <Button dense onClick={openTemplateManagementPopout} disabled={pending}>
          템플릿 관리
        </Button>
      </div>
      <CryptoAutoPanel
        enabled={market.startsWith('KRW-')}
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
  onStrategySave,
  pending,
  strategy,
  strategyLoading,
}: {
  enabled: boolean;
  onStrategySave: (profile: CryptoStrategyProfile) => void;
  pending: boolean;
  strategy: CryptoStrategyProfile;
  strategyLoading: boolean;
}): ReactElement => (
  <section className="panel crypto-account-panel crypto-auto-panel">
    <div className="panel__title crypto-auto-panel__title">
      <span>자동감시</span>
      <Button
        dense
        variant="ghost"
        aria-label="고급/안전 설정 열기"
        onClick={openAdvancedSettingsPopout}
      >
        고급/안전 →
      </Button>
    </div>
    {!enabled ? (
      <div className="panel__body muted">Upbit KRW 실전 계좌와 KRW 마켓에서만 동작합니다.</div>
    ) : (
      <div className="panel__body crypto-auto-panel__body">
        {strategyLoading ? <span className="muted">차수 전략 로드 중…</span> : null}
        <CryptoStrategyForm
          disabled={pending}
          profile={strategy}
          onSubmit={onStrategySave}
          chrome="content"
          submitLabel="설정 저장"
          submitAriaLabel="코인 설정 저장"
        />
      </div>
    )}
  </section>
);
