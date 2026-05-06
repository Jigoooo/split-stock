import { useActiveAccountId } from '@renderer/entities/account';
import { CryptoStrategyForm } from '@renderer/pages/main/ui/crypto-strategy-form';
import { trpc } from '@renderer/shared/api/trpc';
import { alertDialog, Button, Checkbox, DialogType, Select, TextInput } from '@renderer/shared/ui';
import type {
  CryptoAutoGuardConfig,
  CryptoAutoTemplate,
  CryptoKrwMarketCode,
  CryptoStrategyProfile,
} from '@shared/contracts';
import { createDefaultCryptoStrategyProfile, DEFAULT_CRYPTO_MARKET } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

type CryptoSettingsTab = 'basic' | 'templates' | 'protection' | 'conditions' | 'fee';

interface CryptoStrategySettingsSectionProps {
  activeTab: CryptoSettingsTab;
}

// 매매설정관리는 코인별로 분기하지 않고 단일 default(KRW-BTC를 키로 사용)로 통합한다.
// 자동감시 등록 시 이 default가 마켓별로 복사된다. (RALPLAN P4 — 항목 7)
// `@shared/contracts` 의 DEFAULT_CRYPTO_MARKET (= 'KRW-BTC') 을 그대로 사용한다.
const DEFAULT_MARKET = DEFAULT_CRYPTO_MARKET as CryptoKrwMarketCode;

export function CryptoStrategySettingsSection({
  activeTab,
}: CryptoStrategySettingsSectionProps): ReactElement {
  const utils = trpc.useUtils();
  const { accountId } = useActiveAccountId();
  const market = DEFAULT_MARKET;
  const [draft, setDraft] = useState<CryptoStrategyProfile>(() =>
    createDefaultCryptoStrategyProfile(DEFAULT_MARKET),
  );
  const [maxOrderKrw, setMaxOrderKrw] = useState('5000');
  const [maxExposureKrw, setMaxExposureKrw] = useState('50000');
  const [emergencyDisabled, setEmergencyDisabled] = useState(true);
  const autoInput = useMemo(
    () => ({
      ...(accountId !== null ? { accountId } : {}),
      market,
    }),
    [accountId],
  );
  const enabled = accountId !== null;
  const strategyQuery = trpc.crypto.getAutoStrategy.useQuery(autoInput, { enabled });
  const statusQuery = trpc.crypto.getAutoStatus.useQuery(autoInput, { enabled });
  const templatesQuery = trpc.crypto.listAutoStrategyTemplates.useQuery(
    accountId !== null ? { accountId } : undefined,
    { enabled: accountId !== null },
  );
  const saveStrategy = trpc.crypto.saveAutoStrategy.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStrategy.invalidate(autoInput);
    },
  });
  const saveConfig = trpc.crypto.saveAutoConfig.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate(autoInput);
    },
  });
  const saveTemplate = trpc.crypto.saveAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate(
        accountId !== null ? { accountId } : undefined,
      );
    },
  });
  const deleteTemplate = trpc.crypto.deleteAutoStrategyTemplate.useMutation({
    onSuccess: () => {
      void utils.crypto.listAutoStrategyTemplates.invalidate(
        accountId !== null ? { accountId } : undefined,
      );
    },
  });

  useEffect(() => {
    setDraft(strategyQuery.data?.profile ?? createDefaultCryptoStrategyProfile(market));
  }, [strategyQuery.data?.profile]);

  useEffect(() => {
    const config = statusQuery.data?.config;
    if (!config) return;
    setMaxOrderKrw(config.maxOrderKrw);
    setMaxExposureKrw(config.maxTotalExposureKrw);
    setEmergencyDisabled(config.emergencyDisabled);
  }, [statusQuery.data?.config]);

  const templates = templatesQuery.data?.templates ?? [];
  const pending =
    saveStrategy.isPending ||
    saveConfig.isPending ||
    saveTemplate.isPending ||
    deleteTemplate.isPending;

  const saveDraft = (nextDraft = draft): void => {
    if (!enabled) return;
    saveStrategy.mutate({ ...autoInput, profile: nextDraft });
  };
  const saveGuard = (): void => {
    if (!enabled) return;
    saveConfig.mutate({
      ...autoInput,
      config: {
        emergencyDisabled,
        maxOrderKrw,
        maxTotalExposureKrw: maxExposureKrw,
      } satisfies Partial<CryptoAutoGuardConfig>,
    });
  };

  return (
    <div className="panel">
      <div className="panel__title">
        <span>코인 매매설정관리 (모든 코인 공통)</span>
      </div>
      {accountId === null ? (
        <div className="panel__body muted">활성 Upbit 계좌가 필요합니다.</div>
      ) : activeTab === 'basic' ? (
        <CryptoStrategyForm
          disabled={pending || strategyQuery.isFetching}
          profile={draft}
          chrome="content"
          submitLabel="기본값 저장"
          submitAriaLabel="코인 기본 매매 설정 저장"
          onSubmit={(profile) => {
            setDraft(profile);
            saveDraft(profile);
          }}
        />
      ) : activeTab === 'templates' ? (
        <CryptoTemplateManagementPanel
          accountId={accountId}
          activeProfile={draft}
          market={market}
          onDelete={(id) => deleteTemplate.mutate({ accountId, id })}
          onSave={(name, profile, id) =>
            saveTemplate.mutate({
              accountId,
              name,
              strategy: profile,
              ...(id !== undefined ? { id } : {}),
            })
          }
          pending={pending}
          templates={templates}
        />
      ) : activeTab === 'protection' ? (
        <CryptoProtectionForm
          disabled={pending || statusQuery.isFetching}
          emergencyDisabled={emergencyDisabled}
          maxExposureKrw={maxExposureKrw}
          maxOrderKrw={maxOrderKrw}
          onEmergencyDisabledChange={setEmergencyDisabled}
          onMaxExposureKrwChange={(value) => setMaxExposureKrw(sanitizeDecimal(value))}
          onMaxOrderKrwChange={(value) => setMaxOrderKrw(sanitizeDecimal(value))}
          onSave={saveGuard}
        />
      ) : activeTab === 'conditions' ? (
        <CryptoConditionForm
          disabled={pending || strategyQuery.isFetching}
          draft={draft}
          onDraftChange={setDraft}
          onSave={() => saveDraft()}
        />
      ) : (
        <CryptoFeeForm />
      )}
    </div>
  );
}

function CryptoConditionForm({
  disabled,
  draft,
  onDraftChange,
  onSave,
}: {
  disabled: boolean;
  draft: CryptoStrategyProfile;
  onDraftChange: (profile: CryptoStrategyProfile) => void;
  onSave: () => void;
}): ReactElement {
  return (
    <div className="panel__body crypto-settings-form">
      <Checkbox
        checked={draft.autoBuyEnabled}
        disabled={disabled}
        label="자동매수 사용"
        onChange={(event) =>
          onDraftChange({ ...draft, autoBuyEnabled: event.currentTarget.checked })
        }
      />
      <Checkbox
        checked={draft.autoSellEnabled}
        disabled={disabled}
        label="자동매도 사용"
        onChange={(event) =>
          onDraftChange({ ...draft, autoSellEnabled: event.currentTarget.checked })
        }
      />
      <label htmlFor="crypto-settings-buy-order-type">
        <span className="muted">자동매수 주문방식</span>
        <Select
          id="crypto-settings-buy-order-type"
          dense
          disabled={disabled || !draft.autoBuyEnabled}
          value={draft.autoBuyOrderType}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              autoBuyOrderType: event.target.value as CryptoStrategyProfile['autoBuyOrderType'],
            })
          }
        >
          <option value="MARKET">시장가</option>
          <option value="LIMIT">지정가</option>
        </Select>
      </label>
      <label htmlFor="crypto-settings-sell-order-type">
        <span className="muted">자동매도 주문방식</span>
        <Select
          id="crypto-settings-sell-order-type"
          dense
          disabled={disabled || !draft.autoSellEnabled}
          value={draft.autoSellOrderType}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              autoSellOrderType: event.target.value as CryptoStrategyProfile['autoSellOrderType'],
            })
          }
        >
          <option value="MARKET">시장가</option>
          <option value="LIMIT">지정가</option>
        </Select>
      </label>
      <div className="form-sticky-action-bar">
        <Button dense variant="primary" disabled={disabled} onClick={onSave}>
          조건 설정 저장
        </Button>
      </div>
    </div>
  );
}

function CryptoProtectionForm({
  disabled,
  emergencyDisabled,
  maxExposureKrw,
  maxOrderKrw,
  onEmergencyDisabledChange,
  onMaxExposureKrwChange,
  onMaxOrderKrwChange,
  onSave,
}: {
  disabled: boolean;
  emergencyDisabled: boolean;
  maxExposureKrw: string;
  maxOrderKrw: string;
  onEmergencyDisabledChange: (value: boolean) => void;
  onMaxExposureKrwChange: (value: string) => void;
  onMaxOrderKrwChange: (value: string) => void;
  onSave: () => void;
}): ReactElement {
  return (
    <div className="panel__body crypto-settings-form">
      <Checkbox
        checked={emergencyDisabled}
        disabled={disabled}
        label="비상 중지"
        onChange={(event) => onEmergencyDisabledChange(event.currentTarget.checked)}
      />
      <label htmlFor="crypto-settings-max-order-krw">
        <span className="muted">주문당 상한</span>
        <TextInput
          id="crypto-settings-max-order-krw"
          aria-label="주문당 상한"
          dense
          disabled={disabled}
          value={maxOrderKrw}
          onChange={(event) => onMaxOrderKrwChange(event.target.value)}
        />
      </label>
      <label htmlFor="crypto-settings-max-exposure-krw">
        <span className="muted">총 노출 상한</span>
        <TextInput
          id="crypto-settings-max-exposure-krw"
          aria-label="총 노출 상한"
          dense
          disabled={disabled}
          value={maxExposureKrw}
          onChange={(event) => onMaxExposureKrwChange(event.target.value)}
        />
      </label>
      <div className="form-sticky-action-bar">
        <Button dense variant="primary" disabled={disabled} onClick={onSave}>
          보호 설정 저장
        </Button>
      </div>
    </div>
  );
}

/**
 * 코인 템플릿 관리 패널 — stock TemplateManagementPanel 와 동등 UX.
 *
 * - Select: 기존 템플릿 선택 (편집 모드)
 * - "새로 추가" 버튼: 새 이름 입력 모드 전환
 * - "템플릿 삭제" 버튼: 선택한 템플릿 confirm 후 삭제
 * - 차수 grid: CryptoStrategyForm chrome="content" 마운트 — 우측 자동매매 설정 탭과 동일 폼
 *
 * 저장 동작:
 * - 새로 추가: 입력한 이름으로 saveTemplate({name, profile}) — name 미입력 시 비활성
 * - 편집: confirm dialog → saveTemplate({name, profile, id})
 */
function CryptoTemplateManagementPanel({
  accountId,
  activeProfile,
  market,
  onDelete,
  onSave,
  pending,
  templates,
}: {
  accountId: number;
  activeProfile: CryptoStrategyProfile;
  market: CryptoKrwMarketCode;
  onDelete: (id: number) => void;
  onSave: (name: string, profile: CryptoStrategyProfile, id?: number) => void;
  pending: boolean;
  templates: CryptoAutoTemplate[];
}): ReactElement {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [draftOverride, setDraftOverride] = useState<CryptoStrategyProfile | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');

  const selectedTemplate =
    templates.find((template) => String(template.id) === selectedTemplateId) ?? null;
  const initial: CryptoStrategyProfile =
    draftOverride ?? (selectedTemplate ? { ...selectedTemplate.strategy, market } : activeProfile);
  const isEditingExisting = selectedTemplateId.length > 0;
  const trimmedNewTemplateName = newTemplateName.trim();
  const submitDisabled = isEditingExisting
    ? !selectedTemplate
    : trimmedNewTemplateName.length === 0;

  if (accountId <= 0) {
    return <div className="panel__body muted">활성 Upbit 계좌가 필요합니다.</div>;
  }

  return (
    <div className="panel__body crypto-settings-form">
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          aria-label="코인 전략 템플릿"
          dense
          disabled={pending || templates.length === 0}
          value={selectedTemplateId}
          onChange={(event) => {
            setSelectedTemplateId(event.target.value);
            setDraftOverride(null);
            setNewTemplateName('');
          }}
          style={{ minWidth: '18rem' }}
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
          disabled={pending}
          onClick={() => {
            setSelectedTemplateId('');
            setDraftOverride(activeProfile);
            setNewTemplateName('');
          }}
        >
          새로 추가
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
              onDelete(selectedTemplate.id);
              setSelectedTemplateId('');
              setDraftOverride(null);
            })();
          }}
        >
          템플릿 삭제
        </Button>
        {templates.length === 0 ? (
          <span className="muted">저장된 템플릿이 없습니다. 새로 추가해서 생성할 수 있습니다.</span>
        ) : null}
      </div>

      {isEditingExisting && selectedTemplate ? (
        <div className="chip" style={{ justifySelf: 'start' }}>
          편집 중 · {selectedTemplate.name}
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
            aria-label="코인 전략 템플릿 이름"
            dense
            disabled={pending}
            placeholder="템플릿 이름"
            value={newTemplateName}
            onChange={(event) => setNewTemplateName(event.target.value)}
            style={{ flex: '1 1 16rem', minWidth: '14rem' }}
          />
        </div>
      )}

      <CryptoStrategyForm
        key={`${selectedTemplateId || 'new'}:${JSON.stringify(initial)}`}
        chrome="content"
        disabled={pending}
        profile={initial}
        submitAriaLabel={isEditingExisting ? '코인 템플릿 덮어쓰기' : '코인 템플릿 저장'}
        submitContextLabel="코인 템플릿"
        submitDisabled={submitDisabled}
        submitLabel={isEditingExisting ? '템플릿 덮어쓰기' : '템플릿 저장'}
        onSubmit={(profile) => {
          if (isEditingExisting && selectedTemplate) {
            void (async () => {
              const confirmed = await alertDialog.confirm({
                type: DialogType.WARNING,
                title: '템플릿 덮어쓰기',
                message: `"${selectedTemplate.name}" 템플릿을 현재 차수 설정으로 덮어씁니다.`,
                confirmText: '덮어쓰기',
                cancelText: '취소',
              });
              if (!confirmed) return;
              onSave(selectedTemplate.name, profile, selectedTemplate.id);
            })();
            return;
          }
          if (trimmedNewTemplateName.length === 0) return;
          onSave(trimmedNewTemplateName, profile);
          setNewTemplateName('');
          setDraftOverride(profile);
        }}
      />
    </div>
  );
}

function CryptoFeeForm(): ReactElement {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env === 'MOCK' ? 'mock' : 'real';
  const feesQuery = trpc.fees.getSettings.useQuery({ env });
  const updateFees = trpc.fees.updateSettings.useMutation();
  const [buy, setBuy] = useState('0.05');
  const [sell, setSell] = useState('0.05');

  useEffect(() => {
    if (!feesQuery.data) return;
    setBuy(String(feesQuery.data.buy));
    setSell(String(feesQuery.data.sell));
  }, [feesQuery.data]);

  const disabled = envQuery.isPending || feesQuery.isPending || updateFees.isPending;

  return (
    <div className="panel__body crypto-settings-form">
      <label htmlFor="crypto-settings-buy-fee">
        <span className="muted">매수 수수료율 (%)</span>
        <TextInput
          id="crypto-settings-buy-fee"
          aria-label="코인 매수 수수료율"
          dense
          disabled={disabled}
          value={buy}
          onChange={(event) => setBuy(sanitizeDecimal(event.target.value))}
        />
      </label>
      <label htmlFor="crypto-settings-sell-fee">
        <span className="muted">매도 수수료율 (%)</span>
        <TextInput
          id="crypto-settings-sell-fee"
          aria-label="코인 매도 수수료율"
          dense
          disabled={disabled}
          value={sell}
          onChange={(event) => setSell(sanitizeDecimal(event.target.value))}
        />
      </label>
      <div className="form-sticky-action-bar">
        <Button
          dense
          variant="primary"
          disabled={disabled}
          onClick={() =>
            updateFees.mutate({
              env,
              buy: Number(buy || 0),
              sell: Number(sell || 0),
              tax: 0,
            })
          }
        >
          수수료 저장
        </Button>
      </div>
    </div>
  );
}

function sanitizeDecimal(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
}
