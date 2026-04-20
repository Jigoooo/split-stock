import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

export interface PreviewLot {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: string;
}

export interface PreviewModalProps {
  open: boolean;
  title: string;
  before: { rows: PreviewLot[]; totalQty: number; totalCost: number };
  after: { rows: PreviewLot[]; totalQty: number; totalCost: number };
  /** 평가용 현재가 — 현재 평가손익 변화 표시용. 0 이면 미표시. */
  currentPrice?: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 변경 사항 미리보기 모달.
 * - before/after 차수 비교
 * - OPEN 차수 합계 (qty/cost) 변화
 * - currentPrice 가 있으면 평가손익 ((currentPrice*qty - cost)) 변화 표시
 */
export const PreviewModal = (props: PreviewModalProps): ReactElement | null => {
  const { open, title, before, after, currentPrice, busy, onCancel, onConfirm } = props;
  if (!open) return null;

  const evalDelta = (qty: number, cost: number): number =>
    currentPrice && currentPrice > 0 ? currentPrice * qty - cost : 0;

  const beforeEval = evalDelta(before.totalQty, before.totalCost);
  const afterEval = evalDelta(after.totalQty, after.totalCost);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="변경 미리보기">
      <div className="modal panel" style={{ minWidth: '32rem' }}>
        <div className="panel__title">{title} — 미리보기</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.95rem' }}>
            <div>
              <div className="muted">변경 전</div>
              <div>
                OPEN 합계 수량: <strong>{before.totalQty.toLocaleString()}</strong>주
              </div>
              <div>
                매입금액: <strong>{before.totalCost.toLocaleString()}</strong>원
              </div>
              {currentPrice && currentPrice > 0 && (
                <div>
                  평가손익:{' '}
                  <strong style={{ color: beforeEval >= 0 ? 'inherit' : 'crimson' }}>
                    {beforeEval.toLocaleString()}원
                  </strong>
                </div>
              )}
            </div>
            <div style={{ alignSelf: 'center', fontSize: '1.4rem' }}>→</div>
            <div>
              <div className="muted">변경 후</div>
              <div>
                OPEN 합계 수량: <strong>{after.totalQty.toLocaleString()}</strong>주
              </div>
              <div>
                매입금액: <strong>{after.totalCost.toLocaleString()}</strong>원
              </div>
              {currentPrice && currentPrice > 0 && (
                <div>
                  평가손익:{' '}
                  <strong style={{ color: afterEval >= 0 ? 'inherit' : 'crimson' }}>
                    {afterEval.toLocaleString()}원
                  </strong>
                </div>
              )}
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '20rem', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border, #ccc)' }}>
                  <th style={{ textAlign: 'left', padding: '0.3rem' }}>차수</th>
                  <th style={{ textAlign: 'left', padding: '0.3rem' }}>상태</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>before 단가</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>after 단가</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>before 수량</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>after 수량</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const allNths = Array.from(
                    new Set([...before.rows.map((r) => r.nth), ...after.rows.map((r) => r.nth)]),
                  ).sort((a, b) => a - b);
                  return allNths.map((nth) => {
                    const b = before.rows.find((r) => r.nth === nth);
                    const a = after.rows.find((r) => r.nth === nth);
                    const changed =
                      (b?.buyPrice ?? -1) !== (a?.buyPrice ?? -1) ||
                      (b?.qty ?? -1) !== (a?.qty ?? -1);
                    return (
                      <tr
                        key={nth}
                        style={{
                          borderBottom: '1px solid var(--color-border, #eee)',
                          backgroundColor: changed
                            ? 'var(--color-highlight-bg, #fffbe6)'
                            : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.3rem' }}>{nth}차</td>
                        <td style={{ padding: '0.3rem' }}>{a?.status ?? b?.status ?? '-'}</td>
                        <td style={{ padding: '0.3rem', textAlign: 'right' }}>
                          {b?.buyPrice?.toLocaleString() ?? '-'}
                        </td>
                        <td style={{ padding: '0.3rem', textAlign: 'right', fontWeight: 600 }}>
                          {a?.buyPrice?.toLocaleString() ?? '(삭제)'}
                        </td>
                        <td style={{ padding: '0.3rem', textAlign: 'right' }}>
                          {b?.qty?.toLocaleString() ?? '-'}
                        </td>
                        <td style={{ padding: '0.3rem', textAlign: 'right' }}>
                          {a?.qty?.toLocaleString() ?? '(삭제)'}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} disabled={busy} dense>
            취소
          </Button>
          <Button onClick={onConfirm} disabled={busy} variant="primary" dense>
            적용
          </Button>
        </div>
      </div>
    </div>
  );
};
