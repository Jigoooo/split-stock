import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

type ApplyScope = 'active' | 'all';

interface Props {
  scope: ApplyScope;
  sourceNth: number;
  targetCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 차수 규칙 템플릿 일괄 적용 확인 모달 — 민감한 작업(기존 규칙 덮어쓰기)에 대한 확인.
 */
export const ApplyTemplateConfirmModal = ({
  scope,
  sourceNth,
  targetCount,
  onCancel,
  onConfirm,
}: Props): ReactElement => {
  const isDestructive = scope === 'all';

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="템플릿 적용 확인">
      <div className="modal panel">
        <div className="panel__title">템플릿 적용 확인</div>
        <div className="panel__body" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
          <p>
            {scope === 'active'
              ? `기준 차수 ${sourceNth}차의 규칙을 활성 ${targetCount}개 차수(1~${targetCount}차)에 일괄 적용합니다. 기존 규칙은 모두 덮어써집니다.`
              : `⚠ 기준 차수 ${sourceNth}차의 규칙을 1~50차 모든 차수에 일괄 적용합니다. 비활성 차수까지 포함해 기존 규칙이 모두 덮어써집니다.`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={onCancel} dense>
              취소
            </Button>
            <Button onClick={onConfirm} variant={isDestructive ? 'destructive' : 'primary'} dense>
              확인
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
