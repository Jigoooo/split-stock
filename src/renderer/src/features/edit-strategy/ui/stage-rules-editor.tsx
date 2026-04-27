import { Button, OverlayScrollbar, Select } from '@renderer/shared/ui';
import type { StrategyOrderType } from '@shared/contracts';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import type {
  ApplyScope,
  StageRuleChangeFactory,
  StageRuleRowRaw,
} from '../model/strategy-form-types';
import type { StrategyFormErrors } from '../model/validate';
import { ApplyTemplateConfirmModal } from './apply-template-confirm-modal';
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
  const [pendingScope, setPendingScope] = useState<ApplyScope | null>(null);

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
          <Button onClick={() => setPendingScope('active')} disabled={disabled} dense>
            활성 차수 전체 적용
          </Button>
          <Button onClick={() => setPendingScope('all')} disabled={disabled} dense>
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

      {pendingScope !== null ? (
        <ApplyTemplateConfirmModal
          scope={pendingScope}
          sourceNth={parseInt(templateNth, 10) || 1}
          targetCount={pendingScope === 'active' ? activeMaxStages : 50}
          onCancel={() => setPendingScope(null)}
          onConfirm={() => {
            const scope = pendingScope;
            setPendingScope(null);
            onApplyTemplate(scope);
          }}
        />
      ) : null}
    </section>
  );
};
