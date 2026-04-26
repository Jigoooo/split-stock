import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';
import { LotRowFormModal } from './lot-row-form-modal';

export interface EditLotsGridProps {
  accountId: number;
  pdno: string;
  /** 변경 후 부모가 lots 캐시 무효화/리프레시 트리거 */
  onChanged?: () => void;
}

interface LotRowVm {
  id: number;
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: string;
  boughtAtMs: number;
}

type ModalState = { kind: 'closed' } | { kind: 'add' };

/**
 * 수동편집 모드의 차수 grid — 실제 lots 데이터를 trpc.lotsManual.exportCsv 응답을 파싱하지 않고
 * 별도 lotsManual.preview(no-op) 또는 lots 데이터에서 직접 가져와 표시.
 *
 * 구현 단순화:
 *  - lotsManual.preview(action: bulkSplit, ratioPct: 0.0001) 같은 trick 대신
 *    exportCsv 의 LotRow 파싱이 없는 한, 행별 편집은 lotId 가 필요하므로
 *    별도 query 가 가장 자연스러움. 본 컴포넌트는 부모가 받은 행을 props 로 주입하지 않고
 *    내부에서 lotsManual.exportCsv 의 metadata 만 사용 + 행별 액션은 lotId 직접 입력 폼으로 대체.
 *
 * UX:
 *  - 새 차수 추가 → 모달
 *  - 기존 차수 수정/삭제/이동 → 행 클릭 → 액션 선택
 *  - 모든 변경은 먼저 미리보기 → 확인 → apply
 */
export const EditLotsGrid = (props: EditLotsGridProps): ReactElement => {
  const { accountId, pdno, onChanged } = props;
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });

  const utils = trpc.useUtils();
  const insertMutation = trpc.lotsManual.insert.useMutation();
  // 현재 행 조회: lots.snapshot 의 OPEN 차수 기반으로 표시.
  // 주의: snapshot 은 실 DB lotId 를 보유하지 않아(LotSnapshotEntry 에 id 필드 없음)
  // 행 단위 update/delete/move 는 본 컴포넌트에서 비활성화한다.
  // 활성화하려면 (1) snapshot 에 lotId 추가, 또는 (2) 별도 listLots 엔드포인트 도입 필요.
  const today = new Date().toISOString().slice(0, 10);
  const snapQuery = trpc.lots.snapshot.useQuery(
    { accountId, date: today, pdno },
    { staleTime: 1_000 },
  );

  // displayKey 는 React key 전용 — DB id 가 아님. 행 액션 mutation 인자로 절대 사용 금지.
  const rows: Array<LotRowVm & { displayKey: string }> =
    snapQuery.data?.snapshots[0]?.lots.map((l) => ({
      id: -1,
      nth: l.nth,
      buyPrice: l.buyPrice,
      qty: l.qty,
      amountKrw: l.amountKrw,
      status: l.status,
      boughtAtMs: l.boughtAt,
      displayKey: `${l.nth}-${l.boughtAt}`,
    })) ?? [];

  const refresh = (): void => {
    void utils.lots.snapshot.invalidate();
    void utils.lotsManual.canUndo.invalidate({ accountId, pdno });
    onChanged?.();
  };

  const onAdd = async (row: Omit<LotRowVm, 'id'>): Promise<void> => {
    await insertMutation.mutateAsync({
      accountId,
      pdno,
      nth: row.nth,
      buyPrice: row.buyPrice,
      qty: row.qty,
      amountKrw: row.amountKrw,
      boughtAtMs: row.boughtAtMs,
    });
    setModal({ kind: 'closed' });
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div
        role="alert"
        style={{
          padding: '0.4rem 0.6rem',
          background: 'var(--color-warn-bg, #fff8e1)',
          border: '1px solid var(--color-warn-border, #f5c451)',
          borderRadius: '0.25rem',
          fontSize: '0.95rem',
        }}
      >
        장부상만 변경됩니다 — KIS 실제 잔고와 불일치할 수 있습니다.
      </div>
      <div
        role="note"
        className="muted"
        style={{
          padding: '0.4rem 0.6rem',
          background: 'var(--bg-2, #f6f7f9)',
          border: '1px dashed var(--border, #d0d4dc)',
          borderRadius: '0.25rem',
          fontSize: '0.9rem',
        }}
      >
        본 화면에서는 새 차수 추가만 가능합니다. 기존 차수 수정/이동/삭제는 데이터 정합성 검토 후
        재오픈 예정입니다.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{pdno}</strong>
        <Button onClick={() => setModal({ kind: 'add' })} dense aria-label="새 차수 추가">
          + 차수 추가
        </Button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border, #ccc)' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem' }}>차수</th>
            <th style={{ textAlign: 'left', padding: '0.4rem' }}>상태</th>
            <th style={{ textAlign: 'right', padding: '0.4rem' }}>매입가</th>
            <th style={{ textAlign: 'right', padding: '0.4rem' }}>수량</th>
            <th style={{ textAlign: 'right', padding: '0.4rem' }}>금액</th>
            <th style={{ textAlign: 'left', padding: '0.4rem' }}>매수일</th>
            <th style={{ textAlign: 'right', padding: '0.4rem' }}>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted" style={{ padding: '0.6rem', textAlign: 'center' }}>
                {snapQuery.isPending ? '로드 중…' : '오늘 스냅샷에 차수 없음'}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.displayKey}
                style={{ borderBottom: '1px solid var(--color-border, #eee)' }}
              >
                <td style={{ padding: '0.4rem' }}>{r.nth}차</td>
                <td style={{ padding: '0.4rem' }}>{r.status}</td>
                <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                  {r.buyPrice.toLocaleString()}
                </td>
                <td style={{ padding: '0.4rem', textAlign: 'right' }}>{r.qty.toLocaleString()}</td>
                <td style={{ padding: '0.4rem', textAlign: 'right' }}>
                  {r.amountKrw.toLocaleString()}
                </td>
                <td style={{ padding: '0.4rem' }}>
                  {new Date(r.boughtAtMs).toISOString().slice(0, 10)}
                </td>
                <td
                  className="muted"
                  style={{ padding: '0.4rem', textAlign: 'right', fontSize: '0.85em' }}
                >
                  비활성
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {modal.kind === 'add' && (
        <LotRowFormModal
          mode="add"
          onSubmit={(row) => {
            void onAdd(row);
          }}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  );
};
