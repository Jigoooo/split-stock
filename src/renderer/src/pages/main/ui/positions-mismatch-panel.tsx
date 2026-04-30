import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';
import { describeMismatchReason } from '../lib/positions-grid-format';
import type { UsePositionsGridResult } from '../model/use-positions-grid';

interface PositionsMismatchPanelProps {
  mismatches: UsePositionsGridResult['mismatches'];
  pendingMismatches: UsePositionsGridResult['pendingMismatches'];
  syncStatus: UsePositionsGridResult['syncStatus'];
  brokerLabel: string;
  onSync: () => void;
  syncPending: boolean;
}

export const PositionsMismatchPanel = ({
  brokerLabel,
  mismatches,
  onSync,
  pendingMismatches,
  syncStatus,
  syncPending,
}: PositionsMismatchPanelProps): ReactElement => {
  const [showDetails, setShowDetails] = useState(false);
  const isReconciling = syncStatus === 'RECONCILING';
  const visibleMismatches = isReconciling ? pendingMismatches : mismatches;

  return (
    <div style={{ flexShrink: 0 }}>
      <div
        className="panel__body"
        style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: '0.6rem' }}
      >
        <span className={isReconciling ? 'chip chip--live' : 'chip chip--down'} role="status">
          {isReconciling
            ? `${brokerLabel} 잔고와 차수 장부 체결 반영 중 ${thousandSeparator(
                pendingMismatches.length,
              )}건`
            : `${brokerLabel} 잔고와 차수 장부 불일치 ${thousandSeparator(mismatches.length)}건`}
        </span>
        <Button dense disabled={syncPending || isReconciling} onClick={onSync}>
          {syncPending ? '동기화 중…' : '동기화'}
        </Button>
        <Button
          dense
          onClick={() => setShowDetails((current) => !current)}
          aria-expanded={showDetails}
        >
          {showDetails ? '상세 숨기기' : '상세 보기'}
        </Button>
      </div>
      {showDetails ? (
        <div className="panel__body muted" style={{ display: 'grid', gap: '0.3rem' }}>
          {visibleMismatches.map((mismatch) => (
            <div key={`${mismatch.pdno}:${mismatch.reason}`}>
              <span className="num">{mismatch.pdno}</span>
              {' · '}
              {isReconciling ? '매도중/체결 반영 중' : describeMismatchReason(mismatch.reason)}
              {` · ${brokerLabel} `}
              <span className="num">{thousandSeparator(mismatch.kisQty)}주</span>
              {' / lot '}
              <span className="num">{thousandSeparator(mismatch.lotQty)}주</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
