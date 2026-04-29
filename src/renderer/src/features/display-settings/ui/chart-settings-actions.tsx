import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface ChartSettingsActionsProps {
  isDirty: boolean;
  isSaving: boolean;
  onReset: () => void;
  onSave: () => void;
}

export const ChartSettingsActions = ({
  isDirty,
  isSaving,
  onReset,
  onSave,
}: ChartSettingsActionsProps): ReactElement => (
  // min-height/width 고정으로 isSaving 토글 시 layout shift 방지 (마우스 튐 차단).
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '0.6rem',
      minHeight: '2.4rem',
      alignItems: 'center',
    }}
  >
    <Button
      onClick={onReset}
      disabled={isSaving}
      variant="default"
      dense
      aria-label="차트 설정 초기화"
      style={{ minWidth: '5.2rem' }}
    >
      초기화
    </Button>
    <Button
      onClick={onSave}
      disabled={isSaving || !isDirty}
      variant="primary"
      dense
      aria-label="차트 설정 저장"
      style={{ minWidth: '5.2rem' }}
    >
      저장
    </Button>
  </div>
);
