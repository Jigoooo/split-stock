import { useActiveAccountId } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, Checkbox, Select, TextInput } from '@renderer/shared/ui';
import type {
  CryptoAutoGuardConfig,
  CryptoAutoTemplate,
  CryptoKrwMarketCode,
  CryptoStrategyProfile,
} from '@shared/contracts';
import { createCryptoStrategyRules, createDefaultCryptoStrategyProfile } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

type CryptoSettingsTab = 'basic' | 'templates' | 'protection' | 'conditions' | 'fee';

interface CryptoStrategySettingsSectionProps {
  activeTab: CryptoSettingsTab;
}

const DEFAULT_MARKET = 'KRW-BTC' as CryptoKrwMarketCode;

export function CryptoStrategySettingsSection({
  activeTab,
}: CryptoStrategySettingsSectionProps): ReactElement {
  const utils = trpc.useUtils();
  const { accountId } = useActiveAccountId();
  const [market, setMarket] = useState<CryptoKrwMarketCode>(DEFAULT_MARKET);
  const [draft, setDraft] = useState<CryptoStrategyProfile>(() =>
    createDefaultCryptoStrategyProfile(DEFAULT_MARKET),
  );
  const [maxOrderKrw, setMaxOrderKrw] = useState('5000');
  const [maxExposureKrw, setMaxExposureKrw] = useState('50000');
  const [emergencyDisabled, setEmergencyDisabled] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('기본 코인 차수 전략');

  const marketsQuery = trpc.crypto.listMarkets.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const autoInput = useMemo(
    () => ({
      ...(accountId !== null ? { accountId } : {}),
      market,
    }),
    [accountId, market],
  );
  const enabled = accountId !== null && market.startsWith('KRW-');
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
    const next = marketsQuery.data?.entries.find((entry) => entry.market.startsWith('KRW-'));
    if (next && !marketsQuery.data?.entries.some((entry) => entry.market === market)) {
      setMarket(next.market as CryptoKrwMarketCode);
    }
  }, [market, marketsQuery.data?.entries]);

  useEffect(() => {
    setDraft(strategyQuery.data?.profile ?? createDefaultCryptoStrategyProfile(market));
  }, [market, strategyQuery.data?.profile]);

  useEffect(() => {
    const config = statusQuery.data?.config;
    if (!config) return;
    setMaxOrderKrw(config.maxOrderKrw);
    setMaxExposureKrw(config.maxTotalExposureKrw);
    setEmergencyDisabled(config.emergencyDisabled);
  }, [statusQuery.data?.config]);

  const templates = templatesQuery.data?.templates ?? [];
  const selectedTemplate = templates.find((template) => String(template.id) === templateId) ?? null;
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
        <span>코인 매매설정관리</span>
        <Select
          dense
          aria-label="코인 매매설정 마켓"
          value={market}
          disabled={marketsQuery.isPending || pending}
          onChange={(event) => setMarket(event.target.value as CryptoKrwMarketCode)}
          style={{ minWidth: '12rem' }}
        >
          {(marketsQuery.data?.entries ?? [{ market: DEFAULT_MARKET, koreanName: '비트코인' }])
            .filter((entry) => entry.market.startsWith('KRW-'))
            .map((entry) => (
              <option key={entry.market} value={entry.market}>
                {entry.koreanName} ({entry.market})
              </option>
            ))}
        </Select>
      </div>
      {accountId === null ? (
        <div className="panel__body muted">활성 Upbit 계좌가 필요합니다.</div>
      ) : activeTab === 'basic' ? (
        <CryptoBasicStrategyForm
          disabled={pending || strategyQuery.isFetching}
          draft={draft}
          onDraftChange={setDraft}
          onSave={() => saveDraft()}
        />
      ) : activeTab === 'templates' ? (
        <CryptoTemplateForm
          disabled={pending}
          draft={draft}
          onDelete={() => {
            if (accountId !== null && selectedTemplate) {
              deleteTemplate.mutate({ accountId, id: selectedTemplate.id });
            }
          }}
          onLoad={() => {
            if (!selectedTemplate) return;
            const next = { ...selectedTemplate.strategy, market };
            setDraft(next);
            saveDraft(next);
          }}
          onNameChange={setTemplateName}
          onSave={() => {
            if (accountId !== null && templateName.trim()) {
              saveTemplate.mutate({ accountId, name: templateName.trim(), strategy: draft });
            }
          }}
          onTemplateChange={setTemplateId}
          selectedTemplate={selectedTemplate}
          templateId={templateId}
          templateName={templateName}
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

function CryptoBasicStrategyForm({
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
  // 국내주식 stage-rules-editor 패턴: 항상 1~50차를 렌더하고
  // maxStages 초과 차수는 disabled 처리해 사용자가 관리차수 확장 효과를 즉시 인지하게 한다.
  const rows = Array.from({ length: 50 }, (_, index) => {
    const nth = index + 1;
    const buyRule = draft.buyRules.find((r) => r.nth === nth) ?? {
      nth,
      amountKrw: '5000',
      triggerDropPct: nth === 1 ? null : '0.03',
    };
    const sellRule = draft.sellRules.find((r) => r.nth === nth) ?? {
      nth,
      targetProfitPct: '0.02',
    };
    return { nth, buyRule, sellRule };
  });
  return (
    <div className="panel__body crypto-settings-form">
      <label htmlFor="crypto-settings-max-stages">
        <span className="muted">최대 관리차수</span>
        <TextInput
          id="crypto-settings-max-stages"
          aria-label="최대 관리차수"
          dense
          disabled={disabled}
          value={String(draft.maxStages)}
          onChange={(event) => onDraftChange(resizeProfile(draft, Number(event.target.value)))}
        />
      </label>
      <div className="crypto-settings-stage-grid">
        <div className="crypto-settings-stage-grid__header">
          <span>차수</span>
          <span>매수금액</span>
          <span>하락률</span>
          <span>익절률</span>
        </div>
        {rows.map(({ nth, buyRule, sellRule }) => {
          const isActive = nth <= draft.maxStages;
          const rowDisabled = disabled || !isActive;
          return (
            <div
              key={nth}
              className={`crypto-settings-stage-grid__row${
                isActive ? '' : ' crypto-settings-stage-grid__row--inactive'
              }`}
            >
              <strong>{nth}차</strong>
              <TextInput
                aria-label={`${nth}차 매수금액`}
                dense
                disabled={rowDisabled}
                value={buyRule.amountKrw}
                onChange={(event) =>
                  onDraftChange(updateBuyRule(draft, nth, 'amountKrw', event.target.value))
                }
              />
              <TextInput
                aria-label={`${nth}차 하락률`}
                dense
                disabled={rowDisabled || nth === 1}
                value={buyRule.triggerDropPct ?? ''}
                onChange={(event) =>
                  onDraftChange(updateBuyRule(draft, nth, 'triggerDropPct', event.target.value))
                }
              />
              <TextInput
                aria-label={`${nth}차 익절률`}
                dense
                disabled={rowDisabled}
                value={sellRule.targetProfitPct}
                onChange={(event) => onDraftChange(updateSellRule(draft, nth, event.target.value))}
              />
            </div>
          );
        })}
      </div>
      <div className="form-sticky-action-bar">
        <Button dense variant="primary" disabled={disabled} onClick={onSave}>
          기본매매 설정 저장
        </Button>
      </div>
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

function CryptoTemplateForm({
  disabled,
  onDelete,
  onLoad,
  onNameChange,
  onSave,
  onTemplateChange,
  selectedTemplate,
  templateId,
  templateName,
  templates,
}: {
  disabled: boolean;
  draft: CryptoStrategyProfile;
  onDelete: () => void;
  onLoad: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onTemplateChange: (value: string) => void;
  selectedTemplate: CryptoAutoTemplate | null;
  templateId: string;
  templateName: string;
  templates: CryptoAutoTemplate[];
}): ReactElement {
  return (
    <div className="panel__body crypto-settings-form">
      <Select
        aria-label="코인 전략 템플릿"
        dense
        disabled={disabled}
        value={templateId}
        onChange={(event) => onTemplateChange(event.target.value)}
      >
        <option value="">템플릿 선택</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
      <TextInput
        aria-label="코인 전략 템플릿 이름"
        dense
        disabled={disabled}
        value={templateName}
        onChange={(event) => onNameChange(event.target.value)}
      />
      <div className="form-sticky-action-bar">
        <Button dense disabled={disabled || !selectedTemplate} onClick={onLoad}>
          불러오기
        </Button>
        <Button
          dense
          variant="primary"
          disabled={disabled || !templateName.trim()}
          onClick={onSave}
        >
          저장
        </Button>
        <Button
          dense
          variant="destructive"
          disabled={disabled || !selectedTemplate}
          onClick={onDelete}
        >
          삭제
        </Button>
      </div>
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

function resizeProfile(profile: CryptoStrategyProfile, value: number): CryptoStrategyProfile {
  const maxStages = Math.max(1, Math.min(50, Number.isFinite(value) ? Math.trunc(value) : 1));
  const defaults = createCryptoStrategyRules(maxStages);
  return {
    ...profile,
    maxStages,
    buyRules: Array.from({ length: maxStages }, (_, index) => {
      const current = profile.buyRules[index];
      const fallback = defaults.buyRules[index];
      return {
        ...(fallback ?? { nth: index + 1, amountKrw: '5000', triggerDropPct: null }),
        ...current,
        nth: index + 1,
        triggerDropPct:
          index === 0 ? null : (current?.triggerDropPct ?? fallback?.triggerDropPct ?? '0.03'),
      };
    }),
    sellRules: Array.from({ length: maxStages }, (_, index) => {
      const current = profile.sellRules[index];
      const fallback = defaults.sellRules[index];
      return {
        ...(fallback ?? { nth: index + 1, targetProfitPct: '0.02' }),
        ...current,
        nth: index + 1,
      };
    }),
  };
}

function updateBuyRule(
  profile: CryptoStrategyProfile,
  nth: number,
  field: 'amountKrw' | 'triggerDropPct',
  rawValue: string,
): CryptoStrategyProfile {
  const value = sanitizeDecimal(rawValue);
  return {
    ...profile,
    buyRules: profile.buyRules.map((rule) =>
      rule.nth === nth
        ? {
            ...rule,
            [field]: field === 'triggerDropPct' && nth === 1 ? null : value,
          }
        : rule,
    ),
  };
}

function updateSellRule(
  profile: CryptoStrategyProfile,
  nth: number,
  rawValue: string,
): CryptoStrategyProfile {
  const value = sanitizeDecimal(rawValue);
  return {
    ...profile,
    sellRules: profile.sellRules.map((rule) =>
      rule.nth === nth ? { ...rule, targetProfitPct: value } : rule,
    ),
  };
}

function sanitizeDecimal(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
}
