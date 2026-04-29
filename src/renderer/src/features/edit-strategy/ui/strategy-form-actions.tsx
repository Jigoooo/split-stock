import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { FormChrome } from '../model/strategy-form-types';

interface StrategyFormActionsProps {
  canSubmit: boolean;
  chrome: FormChrome;
  onSubmit: () => void;
  submitAriaLabel: string | undefined;
  submitContextLabel: string;
  submitLabel: string | undefined;
}

const actionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
} as const;

export const StrategyFormActions = ({
  canSubmit,
  chrome,
  onSubmit,
  submitAriaLabel,
  submitContextLabel,
  submitLabel,
}: StrategyFormActionsProps): ReactElement => (
  <div
    className={`${chrome === 'panel' ? 'panel__body ' : ''}form-sticky-action-bar`}
    style={actionsStyle}
  >
    <span
      className="muted"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: '2.4rem',
        fontSize: '1rem',
        fontWeight: 600,
      }}
    >
      저장 대상 · {submitContextLabel}
    </span>
    <Button
      onClick={onSubmit}
      disabled={!canSubmit}
      dense
      variant="primary"
      aria-label={submitAriaLabel ?? submitLabel ?? '자동매매 설정 저장'}
    >
      {submitLabel ?? '저장'}
    </Button>
  </div>
);
