import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

export interface UndoButtonProps {
  accountId: number;
  pdno: string;
  onUndone?: (restored: number) => void;
}

/**
 * 직전 변경 1회 취소 (계좌+종목 단위).
 * canUndo 쿼리로 가용 여부와 메타(action) 조회 후 활성/비활성 결정.
 */
export const UndoButton = (props: UndoButtonProps): ReactElement => {
  const { accountId, pdno, onUndone } = props;
  const canUndoQuery = trpc.lotsManual.canUndo.useQuery({ accountId, pdno });
  const undoMutation = trpc.lotsManual.undo.useMutation();
  const [error, setError] = useState<string | null>(null);

  const onClick = async (): Promise<void> => {
    setError(null);
    try {
      const res = await undoMutation.mutateAsync({ accountId, pdno });
      onUndone?.(res.restored);
      await canUndoQuery.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const data = canUndoQuery.data;
  const available = data?.available === true;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <Button
        onClick={() => {
          void onClick();
        }}
        disabled={!available || undoMutation.isPending}
        title={
          available && data
            ? `직전 변경 (${data.action}) 취소 — ${data.baselineCount}행 복원`
            : '직전 변경 기록 없음'
        }
        dense
      >
        ↶ 직전 변경 취소
      </Button>
      {error && (
        <span className="chip chip--down" role="alert" style={{ fontSize: '0.85rem' }}>
          {error}
        </span>
      )}
    </div>
  );
};
