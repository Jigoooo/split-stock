import { Select } from '@renderer/shared/ui';
import type { StrategyOrderType } from '@shared/contracts';
import type { ReactElement } from 'react';
import { ORDER_TYPE_OPTIONS } from '../model/options';

interface TradingOrderTypeFieldProps {
  disabled?: boolean | undefined;
  enabled: boolean;
  label: string;
  onChange: (value: StrategyOrderType) => void;
  value: StrategyOrderType;
}

export const TradingOrderTypeField = ({
  disabled,
  enabled,
  label,
  onChange,
  value,
}: TradingOrderTypeFieldProps): ReactElement => (
  <div style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {label}
    </span>
    <Select
      value={value}
      disabled={disabled || !enabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value as StrategyOrderType)}
      dense
    >
      {ORDER_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  </div>
);
