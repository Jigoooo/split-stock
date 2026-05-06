import type {
  StageRuleField,
  StageRuleRowRaw,
} from '@renderer/features/edit-strategy/model/strategy-form-types';
import { NumberField } from '@renderer/features/edit-strategy/ui/number-field';
import { StageRulesEditor } from '@renderer/features/edit-strategy/ui/stage-rules-editor';
import { Button, Select } from '@renderer/shared/ui';
import type { CryptoStrategyAutoMode, CryptoStrategyProfile } from '@shared/contracts';
import {
  createCryptoStrategyRules,
  deriveCryptoStrategyAutoMode,
  MAX_CRYPTO_STRATEGY_STAGES,
} from '@shared/contracts';
import { type ReactElement, useEffect, useMemo, useState } from 'react';

/**
 * 코인 strategy 폼 — settings 페이지와 main 우측 자동매매 설정 탭 둘 다에서 동일하게 사용.
 *
 * chrome='panel'  : settings 페이지 panel 내부 사용. submitLabel='기본값 저장' 권장.
 * chrome='content': main 우측 탭 내부 사용. submitLabel='종목 설정 저장' 권장.
 *
 * 차수 grid 는 항상 1~50 까지 모든 row 를 렌더하고, maxStages 초과 차수는
 * disabled+inactive 시각효과로 표시한다. (국내주식 stage-rules-editor 의 패턴)
 * 사용자가 maxStages 를 줄였다 늘려도 입력값이 유지된다 (slice 패턴 폐기).
 */

const sanitizeDecimal = (value: string): string => {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
};

function applyCryptoStrategyAutoMode(
  profile: CryptoStrategyProfile,
  mode: CryptoStrategyAutoMode,
): CryptoStrategyProfile {
  return {
    ...profile,
    autoBuyEnabled: mode === 'ALL_ON' || mode === 'BUY_ONLY',
    autoSellEnabled: mode === 'ALL_ON' || mode === 'SELL_ONLY',
  };
}

function resizeMaxStages(profile: CryptoStrategyProfile, maxStages: number): CryptoStrategyProfile {
  const safeMaxStages = Math.max(
    1,
    Math.min(MAX_CRYPTO_STRATEGY_STAGES, Math.trunc(maxStages) || 1),
  );
  return { ...profile, maxStages: safeMaxStages };
}

const CRYPTO_STRATEGY_AUTO_MODE_OPTIONS: Array<{
  value: CryptoStrategyAutoMode;
  label: string;
}> = [
  { value: 'ALL_ON', label: '전체 ON' },
  { value: 'ALL_OFF', label: '전체 OFF' },
  { value: 'BUY_ONLY', label: '매수만 ON' },
  { value: 'SELL_ONLY', label: '매도만 ON' },
];

export type CryptoStrategyFormChrome = 'panel' | 'content';

export interface CryptoStrategyFormProps {
  disabled: boolean;
  profile: CryptoStrategyProfile;
  onSubmit: (profile: CryptoStrategyProfile) => void;
  /**
   * 'panel'  : settings 페이지 panel 내부 사용. (default)
   * 'content': main 우측 탭 내부 사용 (외곽 panel 클래스 제거).
   */
  chrome?: CryptoStrategyFormChrome;
  /** 제출 버튼 라벨. 기본값은 컨텍스트별로 다름. */
  submitLabel?: string;
  /** 제출 버튼 aria-label. */
  submitAriaLabel?: string;
  /** disabled 와 별개로 제출 버튼만 비활성화 (예: 템플릿 이름 미입력). */
  submitDisabled?: boolean;
  /** sticky bar 좌측 안내 라벨 — 'panel'/'content' 컨텍스트 별 노출 문구. */
  submitContextLabel?: string;
}

export const CryptoStrategyForm = (props: CryptoStrategyFormProps): ReactElement => {
  const { disabled, onSubmit, profile, submitDisabled = false } = props;
  const chrome: CryptoStrategyFormChrome = props.chrome ?? 'content';
  const submitLabel = props.submitLabel ?? '자동감시 설정 저장';
  const submitAriaLabel = props.submitAriaLabel ?? submitLabel;
  const submitContextLabel = props.submitContextLabel ?? '코인 차수 전략';
  const [draft, setDraft] = useState(profile);
  const [templateNth, setTemplateNth] = useState<string>('1');

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  // 항상 1~50 차수 렌더. 국내주식 stage-rules-editor 와 동일한 StageRuleRowRaw 형태.
  const stageRows: StageRuleRowRaw[] = useMemo(
    () =>
      Array.from({ length: MAX_CRYPTO_STRATEGY_STAGES }, (_, index) => {
        const nth = index + 1;
        const buyRule = draft.buyRules.find((rule) => rule.nth === nth);
        const sellRule = draft.sellRules.find((rule) => rule.nth === nth);
        return {
          nth,
          amountKrw: buyRule?.amountKrw ?? '5000',
          // 1차는 "수동진입" 으로 표시되므로 triggerDropPct 는 빈 값.
          triggerDropPct: nth === 1 ? '' : (buyRule?.triggerDropPct ?? '0.03'),
          targetProfitPct: sellRule?.targetProfitPct ?? '0.02',
        };
      }),
    [draft.buyRules, draft.sellRules],
  );

  const handleStageRuleChange =
    (nth: number, key: StageRuleField) =>
    (raw: string): void => {
      const value = sanitizeDecimal(raw);
      setDraft((current) => {
        if (key === 'amountKrw') {
          return {
            ...current,
            buyRules: ensureBuyRules(current).map((rule) =>
              rule.nth === nth ? { ...rule, amountKrw: value } : rule,
            ),
          };
        }
        if (key === 'triggerDropPct') {
          if (nth === 1) return current;
          return {
            ...current,
            buyRules: ensureBuyRules(current).map((rule) =>
              rule.nth === nth ? { ...rule, triggerDropPct: value } : rule,
            ),
          };
        }
        return {
          ...current,
          sellRules: ensureSellRules(current).map((rule) =>
            rule.nth === nth ? { ...rule, targetProfitPct: value } : rule,
          ),
        };
      });
    };

  const handleApplyTemplate = (scope: 'active' | 'all'): void => {
    const sourceNth = Math.max(1, parseInt(templateNth, 10) || 1);
    setDraft((current) => {
      const sourceBuy = ensureBuyRules(current).find((rule) => rule.nth === sourceNth);
      const sourceSell = ensureSellRules(current).find((rule) => rule.nth === sourceNth);
      const targetCount =
        scope === 'active' ? Math.max(1, current.maxStages) : MAX_CRYPTO_STRATEGY_STAGES;
      const sourceAmount = sourceBuy?.amountKrw ?? '5000';
      const sourceDrop = sourceBuy?.triggerDropPct ?? '0.03';
      const sourceProfit = sourceSell?.targetProfitPct ?? '0.02';
      const buyRules = Array.from({ length: targetCount }, (_, idx) => {
        const nth = idx + 1;
        return {
          nth,
          amountKrw: sourceAmount,
          // 1차는 항상 수동진입 (triggerDropPct=null), 2차+ 는 source drop 적용.
          triggerDropPct: nth === 1 ? null : sourceDrop,
        };
      });
      const sellRules = Array.from({ length: targetCount }, (_, idx) => ({
        nth: idx + 1,
        targetProfitPct: sourceProfit,
      }));
      return { ...current, buyRules, sellRules };
    });
  };

  const formClassName =
    chrome === 'panel'
      ? 'panel strategy-form crypto-strategy-form crypto-strategy-form--panel'
      : 'strategy-form strategy-form--content crypto-strategy-form crypto-strategy-form--content';

  const bodyClassName =
    chrome === 'panel' ? 'panel__body crypto-strategy-form__body' : 'crypto-strategy-form__body';

  return (
    <form
      className={formClassName}
      aria-label="코인 자동감시 설정 폼"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className={bodyClassName}>
        <section
          style={{
            display: 'grid',
            gap: '0.8rem',
            gridTemplateColumns: 'minmax(180px, 220px) minmax(180px, 240px)',
            alignItems: 'end',
          }}
        >
          <NumberField
            id="crypto-strategy-max-stages"
            label="최대 관리차수 (1~50)"
            value={String(draft.maxStages)}
            onValueChange={(value) =>
              setDraft((current) => resizeMaxStages(current, Number(value)))
            }
            error={undefined}
            disabled={disabled}
            inputMode="numeric"
          />
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted" style={{ fontSize: '1.1rem' }}>
              자동감시 상태
            </span>
            <Select
              id="crypto-strategy-auto-mode"
              aria-label="자동감시 상태"
              dense
              disabled={disabled}
              value={deriveCryptoStrategyAutoMode(draft)}
              onChange={(event) =>
                setDraft((current) =>
                  applyCryptoStrategyAutoMode(
                    current,
                    event.target.value as CryptoStrategyAutoMode,
                  ),
                )
              }
            >
              {CRYPTO_STRATEGY_AUTO_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </section>
        <StageRulesEditor
          activeMaxStages={draft.maxStages}
          autoBuyEnabled={draft.autoBuyEnabled}
          autoBuyOrderType={draft.autoBuyOrderType}
          autoSellEnabled={draft.autoSellEnabled}
          autoSellOrderType={draft.autoSellOrderType}
          disabled={disabled}
          errors={{}}
          onApplyTemplate={handleApplyTemplate}
          onAutoBuyOrderTypeChange={(value) =>
            setDraft((current) => ({ ...current, autoBuyOrderType: value }))
          }
          onAutoSellOrderTypeChange={(value) =>
            setDraft((current) => ({ ...current, autoSellOrderType: value }))
          }
          onChange={handleStageRuleChange}
          onTemplateNthChange={setTemplateNth}
          rows={stageRows}
          templateNth={templateNth}
        />
      </div>
      <div className="form-sticky-action-bar crypto-strategy-form__actions">
        <span className="muted">저장 대상 · {submitContextLabel}</span>
        <Button
          dense
          variant="primary"
          disabled={disabled || submitDisabled}
          aria-label={submitAriaLabel}
          onClick={() => onSubmit(normalizeProfileForSubmit(draft))}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};

/**
 * 제출 시 buyRules / sellRules 가 maxStages 와 일치하지 않을 수 있다 (사용자가 입력 후
 * maxStages 변경). DB 스키마 무변경 정책을 유지하기 위해 maxStages 길이로 trim 하고
 * 부족하면 default 로 채워서 보낸다. UI 의 입력값은 1~50 모두 유지되지만,
 * 실제 저장은 활성 차수만.
 */
function normalizeProfileForSubmit(profile: CryptoStrategyProfile): CryptoStrategyProfile {
  const safeMaxStages = Math.max(
    1,
    Math.min(MAX_CRYPTO_STRATEGY_STAGES, Math.trunc(profile.maxStages) || 1),
  );
  const fallback = createCryptoStrategyRules(safeMaxStages, {
    amountKrw: profile.buyRules[0]?.amountKrw ?? '5000',
    dropPct: profile.buyRules[1]?.triggerDropPct ?? '0.03',
    profitPct: profile.sellRules[0]?.targetProfitPct ?? '0.02',
  });
  return {
    ...profile,
    maxStages: safeMaxStages,
    buyRules: Array.from({ length: safeMaxStages }, (_, index) => {
      const nth = index + 1;
      const existing = profile.buyRules.find((rule) => rule.nth === nth);
      const fallbackRule = fallback.buyRules[index] ?? {
        nth,
        amountKrw: '5000',
        triggerDropPct: nth === 1 ? null : '0.03',
      };
      const merged = existing ?? fallbackRule;
      return {
        ...merged,
        nth,
        triggerDropPct: nth === 1 ? null : (merged.triggerDropPct ?? '0.03'),
      };
    }),
    sellRules: Array.from({ length: safeMaxStages }, (_, index) => {
      const nth = index + 1;
      const existing = profile.sellRules.find((rule) => rule.nth === nth);
      const fallbackRule = fallback.sellRules[index] ?? { nth, targetProfitPct: '0.02' };
      return { ...(existing ?? fallbackRule), nth };
    }),
  };
}

function ensureBuyRules(profile: CryptoStrategyProfile): CryptoStrategyProfile['buyRules'] {
  // 입력 도중 buyRules 배열에 없는 nth 가 들어와도 onChange 가 동작하도록 1~50 채움.
  const map = new Map(profile.buyRules.map((rule) => [rule.nth, rule]));
  return Array.from({ length: MAX_CRYPTO_STRATEGY_STAGES }, (_, index) => {
    const nth = index + 1;
    return (
      map.get(nth) ?? {
        nth,
        amountKrw: '5000',
        triggerDropPct: nth === 1 ? null : '0.03',
      }
    );
  });
}

function ensureSellRules(profile: CryptoStrategyProfile): CryptoStrategyProfile['sellRules'] {
  const map = new Map(profile.sellRules.map((rule) => [rule.nth, rule]));
  return Array.from({ length: MAX_CRYPTO_STRATEGY_STAGES }, (_, index) => {
    const nth = index + 1;
    return map.get(nth) ?? { nth, targetProfitPct: '0.02' };
  });
}
