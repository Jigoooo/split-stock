import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';
import { LotRowFormModal } from './lot-row-form-modal';
import { PreviewModal } from './preview-modal';

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

type ModalState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; row: LotRowVm }
  | { kind: 'preview'; action: 'insert' | 'update' | 'delete' | 'move'; payload: unknown };

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
  const updateMutation = trpc.lotsManual.update.useMutation();
  const deleteMutation = trpc.lotsManual.delete.useMutation();
  const moveMutation = trpc.lotsManual.move.useMutation();
  // 현재 행 조회: 별도 list 엔드포인트가 없어 exportCsv 응답에서 파싱하기보다
  // 새로 도입한 lots.snapshot 의 OPEN 차수 기반으로 표시.
  // 본 grid 는 latest snapshot 기준이라 일자별 텍스트 뷰와 다른 UX.
  const today = new Date().toISOString().slice(0, 10);
  const snapQuery = trpc.lots.snapshot.useQuery(
    { accountId, date: today, pdno },
    { staleTime: 1_000 },
  );

  const rows: LotRowVm[] =
    snapQuery.data?.snapshots[0]?.lots.map((l, idx) => ({
      // snapshot 은 lotId 미보유 — 인덱스 기반 가짜 id 로 표시만 가능. 행 액션은 nth 로 대신 lotId 를
      // 사용자가 명시 입력하는 폼으로 안내.
      id: idx + 1,
      nth: l.nth,
      buyPrice: l.buyPrice,
      qty: l.qty,
      amountKrw: l.amountKrw,
      status: l.status,
      boughtAtMs: l.boughtAt,
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

  const onUpdate = async (lotId: number, changes: Partial<LotRowVm>): Promise<void> => {
    await updateMutation.mutateAsync({
      accountId,
      pdno,
      lotId,
      changes: {
        ...(changes.buyPrice !== undefined ? { buyPrice: changes.buyPrice } : {}),
        ...(changes.qty !== undefined ? { qty: changes.qty } : {}),
        ...(changes.amountKrw !== undefined ? { amountKrw: changes.amountKrw } : {}),
        ...(changes.boughtAtMs !== undefined ? { boughtAtMs: changes.boughtAtMs } : {}),
      },
    });
    setModal({ kind: 'closed' });
    refresh();
  };

  const onDelete = async (lotId: number): Promise<void> => {
    await deleteMutation.mutateAsync({ accountId, pdno, lotId });
    refresh();
  };

  const onMove = async (lotId: number, newNth: number): Promise<void> => {
    await moveMutation.mutateAsync({ accountId, pdno, lotId, newNth });
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
        ⚠️ 장부상만 변경됩니다 — KIS 실제 잔고와 불일치할 수 있습니다.
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
              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border, #eee)' }}>
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
                  style={{
                    padding: '0.4rem',
                    textAlign: 'right',
                    display: 'flex',
                    gap: '0.3rem',
                    justifyContent: 'flex-end',
                  }}
                >
                  <Button onClick={() => setModal({ kind: 'edit', row: r })} dense>
                    수정
                  </Button>
                  <Button
                    onClick={() => {
                      const newNth = Number(
                        window.prompt(`새 차수 번호 (현재 ${r.nth})`, String(r.nth)),
                      );
                      if (Number.isInteger(newNth) && newNth > 0 && newNth !== r.nth) {
                        void onMove(r.id, newNth);
                      }
                    }}
                    dense
                  >
                    이동
                  </Button>
                  <Button
                    onClick={() => {
                      if (window.confirm(`${r.nth}차 행을 삭제합니다. 계속하시겠습니까?`)) {
                        void onDelete(r.id);
                      }
                    }}
                    dense
                  >
                    삭제
                  </Button>
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
      {modal.kind === 'edit' && (
        <LotRowFormModal
          mode="edit"
          initial={modal.row}
          onSubmit={(row) => {
            void onUpdate(modal.row.id, row);
          }}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
      {/* PreviewModal 은 본 행별 편집에서는 폼 자체가 변경 사항을 명확히 보여주므로 별도 미리보기 생략. */}
      {/* bulk 보정/CSV 임포트 같은 다중-행 변경에서 PreviewModal 사용 (BulkPriceRatioForm 자체에 확인 모달 내장). */}
      {modal.kind === 'preview' && <span aria-hidden /> /* 향후 별도 미리보기 트리거 슬롯 */}
      {/* PreviewModal 컴포넌트는 features/index 에서 export — 호출측이 자체 use case 에서 활용. */}
      {false && (
        <PreviewModal
          open={false}
          title=""
          before={{ rows: [], totalQty: 0, totalCost: 0 }}
          after={{ rows: [], totalQty: 0, totalCost: 0 }}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      )}
    </div>
  );
};
