import { NumberInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { ErrorChip } from './error-chip';

interface NumberFieldProps {
  disabled?: boolean | undefined;
  error: string | undefined;
  id: string;
  inputMode?: 'numeric' | 'decimal';
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}

export const NumberField = (props: NumberFieldProps): ReactElement => (
  <label htmlFor={props.id} style={{ display: 'grid', gap: '0.3rem' }}>
    <span className="muted" style={{ fontSize: '1.1rem' }}>
      {props.label}
    </span>
    <NumberInput
      id={props.id}
      value={props.value}
      onValueChange={props.onValueChange}
      aria-label={props.label}
      aria-invalid={Boolean(props.error)}
      disabled={props.disabled}
      dense
      inputMode={props.inputMode}
    />
    {props.error ? <ErrorChip message={props.error} /> : null}
  </label>
);
