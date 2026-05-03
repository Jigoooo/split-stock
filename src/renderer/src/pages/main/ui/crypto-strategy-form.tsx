import { Button, Select, TextInput } from '@renderer/shared/ui';
import type { CryptoStrategyAutoMode, CryptoStrategyProfile } from '@shared/contracts';
import {
  createCryptoStrategyRules,
  deriveCryptoStrategyAutoMode,
  MAX_CRYPTO_STRATEGY_STAGES,
} from '@shared/contracts';
import { type ReactElement, useEffect, useState } from 'react';

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

function resizeCryptoStrategyProfile(
  profile: CryptoStrategyProfile,
  maxStages: number,
): CryptoStrategyProfile {
  const safeMaxStages = Math.max(
    1,
    Math.min(MAX_CRYPTO_STRATEGY_STAGES, Math.trunc(maxStages) || 1),
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
      return (
        profile.buyRules[index] ??
        fallback.buyRules[index] ?? {
          nth,
          triggerDropPct: nth === 1 ? null : '0.03',
          amountKrw: '5000',
        }
      );
    }).map((rule, index) => ({
      ...rule,
      nth: index + 1,
      triggerDropPct: index === 0 ? null : (rule.triggerDropPct ?? '0.03'),
    })),
    sellRules: Array.from({ length: safeMaxStages }, (_, index) => {
      const nth = index + 1;
      return (
        profile.sellRules[index] ??
        fallback.sellRules[index] ?? {
          nth,
          targetProfitPct: '0.02',
        }
      );
    }).map((rule, index) => ({ ...rule, nth: index + 1 })),
  };
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

export const CryptoStrategyForm = ({
  disabled,
  onSubmit,
  profile,
}: {
  disabled: boolean;
  onSubmit: (profile: CryptoStrategyProfile) => void;
  profile: CryptoStrategyProfile;
}): ReactElement => {
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const updateRule = (
    nth: number,
    field: 'amountKrw' | 'targetProfitPct' | 'triggerDropPct',
    value: string,
  ): void => {
    const sanitized = sanitizeDecimal(value);
    setDraft((current) => {
      if (field === 'amountKrw' || field === 'triggerDropPct') {
        return {
          ...current,
          buyRules: current.buyRules.map((rule) =>
            rule.nth === nth
              ? {
                  ...rule,
                  [field]: field === 'triggerDropPct' && nth === 1 ? null : sanitized,
                }
              : rule,
          ),
        };
      }
      return {
        ...current,
        sellRules: current.sellRules.map((rule) =>
          rule.nth === nth ? { ...rule, targetProfitPct: sanitized } : rule,
        ),
      };
    });
  };

  const activeRows = draft.buyRules.slice(0, draft.maxStages).map((buyRule, index) => ({
    buyRule,
    sellRule: draft.sellRules[index] ?? { nth: index + 1, targetProfitPct: '0.02' },
  }));

  return (
    <form
      className="strategy-form strategy-form--content crypto-strategy-form"
      aria-label="코인 자동감시 설정 폼"
      onSubmit={(event) => event.preventDefault()}
    >
      <section className="crypto-strategy-form__top">
        <label htmlFor="crypto-strategy-max-stages">
          <span className="muted">최대 관리차수 (1~50)</span>
          <TextInput
            id="crypto-strategy-max-stages"
            aria-label="최대 관리차수"
            dense
            disabled={disabled}
            value={String(draft.maxStages)}
            onChange={(event) =>
              setDraft((current) =>
                resizeCryptoStrategyProfile(current, Number(event.target.value)),
              )
            }
          />
        </label>
        <label htmlFor="crypto-strategy-auto-mode">
          <span className="muted">자동감시 상태</span>
          <Select
            id="crypto-strategy-auto-mode"
            aria-label="자동감시 상태"
            dense
            disabled={disabled}
            value={deriveCryptoStrategyAutoMode(draft)}
            onChange={(event) =>
              setDraft((current) =>
                applyCryptoStrategyAutoMode(current, event.target.value as CryptoStrategyAutoMode),
              )
            }
          >
            {CRYPTO_STRATEGY_AUTO_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor="crypto-strategy-buy-order-type">
          <span className="muted">자동매수 주문방식</span>
          <Select
            id="crypto-strategy-buy-order-type"
            aria-label="자동매수 주문방식"
            dense
            disabled={disabled || !draft.autoBuyEnabled}
            value={draft.autoBuyOrderType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                autoBuyOrderType: event.target.value as CryptoStrategyProfile['autoBuyOrderType'],
              }))
            }
          >
            <option value="MARKET">시장가</option>
            <option value="LIMIT">지정가</option>
          </Select>
        </label>
        <label htmlFor="crypto-strategy-sell-order-type">
          <span className="muted">자동매도 주문방식</span>
          <Select
            id="crypto-strategy-sell-order-type"
            aria-label="자동매도 주문방식"
            dense
            disabled={disabled || !draft.autoSellEnabled}
            value={draft.autoSellOrderType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                autoSellOrderType: event.target.value as CryptoStrategyProfile['autoSellOrderType'],
              }))
            }
          >
            <option value="MARKET">시장가</option>
            <option value="LIMIT">지정가</option>
          </Select>
        </label>
      </section>
      <section aria-label="차수별 자동감시 규칙" className="crypto-strategy-form__rules">
        <div className="muted crypto-strategy-form__rules-title">차수별 규칙</div>
        <div className="crypto-strategy-form__rules-head" role="presentation">
          <span />
          <span className="num-up">매수 규칙</span>
          <span className="num-down">매도 규칙</span>
        </div>
        <div className="crypto-strategy-form__rules-list">
          {activeRows.map(({ buyRule, sellRule }) => (
            <div key={buyRule.nth} className="crypto-strategy-form__rule-row">
              <strong>{buyRule.nth}차</strong>
              <div className="crypto-strategy-form__rule-buy">
                {buyRule.nth === 1 ? (
                  <span className="muted">수동진입</span>
                ) : (
                  <>
                    <TextInput
                      aria-label={`${buyRule.nth}차 자동매수 하락률`}
                      dense
                      disabled={disabled || !draft.autoBuyEnabled}
                      value={buyRule.triggerDropPct ?? ''}
                      onChange={(event) =>
                        updateRule(buyRule.nth, 'triggerDropPct', event.target.value)
                      }
                    />
                    <span>하락시 매수</span>
                  </>
                )}
                <TextInput
                  aria-label={`${buyRule.nth}차 매수금액`}
                  dense
                  disabled={disabled || !draft.autoBuyEnabled}
                  value={buyRule.amountKrw}
                  onChange={(event) => updateRule(buyRule.nth, 'amountKrw', event.target.value)}
                />
                <span>원</span>
              </div>
              <div className="crypto-strategy-form__rule-sell">
                <TextInput
                  aria-label={`${sellRule.nth}차 자동매도 익절률`}
                  dense
                  disabled={disabled || !draft.autoSellEnabled}
                  value={sellRule.targetProfitPct}
                  onChange={(event) =>
                    updateRule(sellRule.nth, 'targetProfitPct', event.target.value)
                  }
                />
                <span>수익시 매도</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="form-sticky-action-bar crypto-strategy-form__actions">
        <span className="muted">저장 대상 · 코인 차수 전략</span>
        <Button
          dense
          variant="primary"
          disabled={disabled}
          aria-label="코인 자동감시 추가/저장"
          onClick={() => onSubmit(draft)}
        >
          자동감시 추가/저장
        </Button>
      </div>
    </form>
  );
};
