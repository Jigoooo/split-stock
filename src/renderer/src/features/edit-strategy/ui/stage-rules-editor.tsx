import { alertDialog, Button, DialogType, OverlayScrollbar, Select } from '@renderer/shared/ui';
import type { StrategyOrderType } from '@shared/contracts';
import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import type {
  ApplyScope,
  StageRuleChangeFactory,
  StageRuleRowRaw,
} from '../model/strategy-form-types';
import type { StrategyFormErrors } from '../model/validate';
import { ErrorChip } from './error-chip';
import {
  STAGE_RULE_CARD_COLUMNS,
  STAGE_RULE_SCROLLBAR_GUTTER,
  StageRuleCard,
} from './stage-rule-card';
import { TradingOrderTypeField } from './trading-order-type-field';

interface StageRulesEditorProps {
  activeMaxStages: number;
  autoBuyEnabled: boolean;
  autoBuyOrderType: StrategyOrderType;
  autoSellEnabled: boolean;
  autoSellOrderType: StrategyOrderType;
  disabled?: boolean | undefined;
  errors: StrategyFormErrors;
  onApplyTemplate: (scope: ApplyScope) => void;
  onAutoBuyOrderTypeChange: (value: StrategyOrderType) => void;
  onAutoSellOrderTypeChange: (value: StrategyOrderType) => void;
  onChange: StageRuleChangeFactory;
  onTemplateNthChange: (value: string) => void;
  rows: StageRuleRowRaw[];
  templateNth: string;
}

export const StageRulesEditor = ({
  activeMaxStages,
  autoBuyEnabled,
  autoBuyOrderType,
  autoSellEnabled,
  autoSellOrderType,
  disabled,
  errors,
  onApplyTemplate,
  onAutoBuyOrderTypeChange,
  onAutoSellOrderTypeChange,
  onChange,
  onTemplateNthChange,
  rows,
  templateNth,
}: StageRulesEditorProps): ReactElement => {
  const rulesScrollRef = useRef<HTMLDivElement | null>(null);

  const requestApply = async (scope: ApplyScope): Promise<void> => {
    const sourceNth = parseInt(templateNth, 10) || 1;
    const targetCount = scope === 'active' ? activeMaxStages : 50;
    const confirmed = await alertDialog.confirm({
      type: DialogType.WARNING,
      title: scope === 'active' ? '활성 차수 전체 적용' : '1~50 전체 적용',
      message: (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', paddingTop: '0.4rem' }}
        >
          <div style={{ fontSize: '1.15em', lineHeight: 1.4 }}>
            기준 차수 <strong style={{ color: 'var(--color-text-primary)' }}>{sourceNth}차</strong>
            의 규칙을{' '}
            {scope === 'active' ? (
              <>
                활성{' '}
                <strong style={{ color: 'var(--color-text-primary)' }}>
                  {targetCount}개 차수(1~{targetCount}차)
                </strong>
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--color-text-primary)' }}>1~50차 모든 차수</strong>
              </>
            )}
            에 일괄 적용합니다.
          </div>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              color: 'var(--down, #d32f2f)',
              fontSize: '0.95em',
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <strong>기존 규칙 덮어쓰기</strong>
              <br />
              기존에 설정된 규칙은 모두 지워지고 새로운 규칙으로 덮어써집니다. 계속할까요?
            </div>
          </div>
        </div>
      ),
      confirmText: '적용',
      cancelText: '취소',
    });
    if (!confirmed) return;
    onApplyTemplate(scope);
  };

  return (
    <section aria-label="차수별 자동매매 규칙" style={{ display: 'grid', gap: '0.8rem' }}>
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          alignItems: 'end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
          차수별 규칙
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: '0.2rem' }}>
            <span className="muted" style={{ fontSize: '0.95rem' }}>
              기준 차수
            </span>
            <Select
              value={templateNth}
              onChange={(event) => onTemplateNthChange(event.target.value)}
              aria-label="전체 적용 기준 차수"
              disabled={disabled}
              dense
              style={{ minWidth: '8rem' }}
            >
              {rows.map((row) => (
                <option key={row.nth} value={String(row.nth)}>
                  {row.nth}차
                </option>
              ))}
            </Select>
          </div>
          <Button
            onClick={() => {
              void requestApply('active');
            }}
            disabled={disabled}
            dense
          >
            활성 차수 전체 적용
          </Button>
          <Button
            onClick={() => {
              void requestApply('all');
            }}
            disabled={disabled}
            dense
          >
            1~50 전체 적용
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '0.8rem',
          gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
        }}
      >
        <TradingOrderTypeField
          label="자동매수 주문방식"
          enabled={autoBuyEnabled}
          value={autoBuyOrderType}
          disabled={disabled}
          onChange={onAutoBuyOrderTypeChange}
        />
        <TradingOrderTypeField
          label="자동매도 주문방식"
          enabled={autoSellEnabled}
          value={autoSellOrderType}
          disabled={disabled}
          onChange={onAutoSellOrderTypeChange}
        />
      </div>

      <div
        role="presentation"
        style={{
          display: 'grid',
          gridTemplateColumns: STAGE_RULE_CARD_COLUMNS,
          alignItems: 'stretch',
          border: '1px solid var(--border)',
          borderRadius: '0.35rem',
          background: 'var(--bg-2)',
          fontSize: '1rem',
          fontWeight: 600,
          marginRight: STAGE_RULE_SCROLLBAR_GUTTER,
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            padding: '0.45rem 0.65rem',
            borderRight: '1px solid var(--border)',
          }}
        />
        <div
          style={{
            padding: '0.45rem 0.75rem',
            borderRight: '1px solid var(--border)',
            color: 'var(--up)',
          }}
        >
          매수 규칙
        </div>
        <div style={{ padding: '0.45rem 0.75rem', color: 'var(--down)' }}>매도 규칙</div>
      </div>

      <div
        ref={rulesScrollRef}
        style={{
          maxHeight: '32rem',
          overflow: 'auto',
          paddingRight: STAGE_RULE_SCROLLBAR_GUTTER,
          position: 'relative',
          scrollbarWidth: 'none',
        }}
      >
        <OverlayScrollbar containerRef={rulesScrollRef} alwaysVisible />
        <div style={{ display: 'grid', gap: '0.45rem' }}>
          {rows.map((row) => {
            const isActive =
              Number.isInteger(activeMaxStages) &&
              activeMaxStages >= 1 &&
              row.nth <= activeMaxStages;
            return (
              <StageRuleCard
                key={row.nth}
                row={row}
                disabled={Boolean(disabled) || !isActive}
                inactive={!isActive}
                onChange={onChange}
              />
            );
          })}
        </div>
      </div>
      {errors.buyRules ? <ErrorChip message={errors.buyRules} /> : null}
      {errors.sellRules ? <ErrorChip message={errors.sellRules} /> : null}
    </section>
  );
};
