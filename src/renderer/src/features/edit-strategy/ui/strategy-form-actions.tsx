import { Button, TextInput } from '@renderer/shared/ui';
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import type { FormChrome } from '../model/strategy-form-types';

interface StrategyFormActionsProps {
  canSavePreset: boolean;
  canSubmit: boolean;
  chrome: FormChrome;
  disabled?: boolean | undefined;
  onSavePreset: () => void;
  onSubmit: () => void;
  presetInput: string;
  setPresetInput: Dispatch<SetStateAction<string>>;
  showPresetSave: boolean;
  submitAriaLabel: string | undefined;
  submitLabel: string | undefined;
}

const actionsStyle = {
  display: 'flex',
  gap: '0.6rem',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
} as const;

export const StrategyFormActions = ({
  canSavePreset,
  canSubmit,
  chrome,
  disabled,
  onSavePreset,
  onSubmit,
  presetInput,
  setPresetInput,
  showPresetSave,
  submitAriaLabel,
  submitLabel,
}: StrategyFormActionsProps): ReactElement => (
  <div className={chrome === 'panel' ? 'panel__body' : undefined} style={actionsStyle}>
    {showPresetSave ? (
      <>
        <TextInput
          id="strategy-preset-name"
          value={presetInput}
          onChange={(event) => setPresetInput(event.target.value)}
          placeholder="템플릿 이름"
          aria-label="템플릿 이름"
          disabled={disabled}
          dense
          style={{ flex: 1, minWidth: 120 }}
        />
        <Button onClick={onSavePreset} disabled={!canSavePreset} dense aria-label="템플릿 저장">
          템플릿 저장
        </Button>
      </>
    ) : null}
    <Button
      onClick={onSubmit}
      disabled={!canSubmit}
      dense
      variant="primary"
      aria-label={submitAriaLabel ?? '자동매매 설정 저장'}
    >
      {submitLabel ?? '저장'}
    </Button>
  </div>
);
