import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface ChartSettingsActionsProps {
  isSaving: boolean;
  onReset: () => void;
  onSave: () => void;
}

export const ChartSettingsActions = ({
  isSaving,
  onReset,
  onSave,
}: ChartSettingsActionsProps): ReactElement => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
    <Button
      onClick={onReset}
      disabled={isSaving}
      variant="default"
      dense
      aria-label="차트 설정 초기화"
    >
      초기화
    </Button>
    <Button
      onClick={onSave}
      disabled={isSaving}
      variant="primary"
      dense
      aria-label="차트 설정 저장"
    >
      저장
    </Button>
  </div>
);
