import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';
import { describeMismatchReason } from '../lib/positions-grid-format';
import type { UsePositionsGridResult } from '../model/use-positions-grid';

interface PositionsMismatchPanelProps {
  mismatches: UsePositionsGridResult['mismatches'];
  onSync: () => void;
  syncPending: boolean;
}

export const PositionsMismatchPanel = ({
  mismatches,
  onSync,
  syncPending,
}: PositionsMismatchPanelProps): ReactElement => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div style={{ flexShrink: 0 }}>
      <div
        className="panel__body"
        style={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: '0.6rem' }}
      >
        <span className="chip chip--down" role="status">
          KIS 잔고와 차수 장부 불일치 {thousandSeparator(mismatches.length)}건
        </span>
        <Button dense disabled={syncPending} onClick={onSync}>
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
          {mismatches.map((mismatch) => (
            <div key={`${mismatch.pdno}:${mismatch.reason}`}>
              <span className="num">{mismatch.pdno}</span>
              {' · '}
              {describeMismatchReason(mismatch.reason)}
              {' · KIS '}
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
