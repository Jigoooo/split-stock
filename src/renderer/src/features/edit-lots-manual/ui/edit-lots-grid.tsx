import { trpc } from '@renderer/shared/api/trpc';
import { formatDateOnly, formatDateTimeLongKo } from '@renderer/shared/lib/formatter';
import {
  alertDialog,
  Button,
  DialogType,
  EmptyState,
  NumberInput,
  TableGrid,
} from '@renderer/shared/ui';
import { AlertTriangle } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { type LotRowDraft, LotRowFormModal } from './lot-row-form-modal';

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
  | { kind: 'move'; row: LotRowVm };

/**
 * 수동편집 모드의 차수 grid.
 *
 * 데이터 소스: lots.listOpen (실 DB OPEN 차수, lotId 포함).
 * snapshot 의 historical view 와 분리 — lotId 정합성으로 행 액션 안전성 보장.
 *
 * 행 액션:
 *  - 새 차수 추가 → LotRowFormModal mode='add'
 *  - 차수 수정 → LotRowFormModal mode='edit' (단가/수량/매수일)
 *  - 차수 이동 → 작은 입력 모달로 새 nth 받음
 *  - 차수 삭제 → alertDialog.confirm
 */
export const EditLotsGrid = (props: EditLotsGridProps): ReactElement => {
  const { accountId, pdno, onChanged } = props;
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });

  const utils = trpc.useUtils();
  const insertMutation = trpc.lotsManual.insert.useMutation();
  const updateMutation = trpc.lotsManual.update.useMutation();
  const deleteMutation = trpc.lotsManual.delete.useMutation();
  const moveMutation = trpc.lotsManual.move.useMutation();

  const openLotsQuery = trpc.lots.listOpen.useQuery({ accountId, pdno }, { staleTime: 1_000 });

  const rows: LotRowVm[] =
    openLotsQuery.data?.lots.map((l) => ({
      id: l.id,
      nth: l.nth,
      buyPrice: l.buyPrice,
      qty: l.qty,
      amountKrw: l.amountKrw,
      status: l.status,
      boughtAtMs: l.boughtAt,
    })) ?? [];

  const refresh = (): void => {
    void utils.lots.listOpen.invalidate({ accountId, pdno });
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

  const onUpdate = async (lotId: number, row: LotRowDraft): Promise<void> => {
    await updateMutation.mutateAsync({
      accountId,
      pdno,
      lotId,
      changes: {
        buyPrice: row.buyPrice,
        qty: row.qty,
        amountKrw: row.amountKrw,
        boughtAtMs: row.boughtAtMs,
      },
    });
    setModal({ kind: 'closed' });
    refresh();
  };

  const onConfirmDelete = async (row: LotRowVm): Promise<void> => {
    const confirmed = await alertDialog.confirm({
      type: DialogType.WARNING,
      title: '차수 삭제',
      message: (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', paddingTop: '0.4rem' }}
        >
          <div style={{ fontSize: '1.15em' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>{row.nth}차</strong> 매수 기록을
            삭제합니다.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '0.6rem',
              }}
            >
              <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>
                수량
              </span>
              <span className="num" style={{ fontSize: '1.1em', fontWeight: 600 }}>
                {row.qty.toLocaleString()}주
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '0.6rem',
              }}
            >
              <span style={{ color: 'var(--color-text-secondary, #666)', fontSize: '0.95em' }}>
                금액
              </span>
              <span className="num" style={{ fontSize: '1.1em', fontWeight: 600 }}>
                {row.amountKrw.toLocaleString()}원
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              color: 'var(--down, #d32f2f)',
              fontSize: '0.95em',
              marginTop: '0.4rem',
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <div>
              <strong>삭제 확인</strong>
              <br />이 작업은 되돌릴 수 없습니다. 계속할까요?
            </div>
          </div>
        </div>
      ),
      confirmText: '삭제',
      cancelText: '취소',
    });
    if (!confirmed) return;
    await deleteMutation.mutateAsync({ accountId, pdno, lotId: row.id });
    refresh();
  };

  const onConfirmMove = async (row: LotRowVm, newNth: number): Promise<void> => {
    if (!Number.isInteger(newNth) || newNth < 1 || newNth === row.nth) {
      setModal({ kind: 'closed' });
      return;
    }
    await moveMutation.mutateAsync({ accountId, pdno, lotId: row.id, newNth });
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{pdno}</strong>
        <Button onClick={() => setModal({ kind: 'add' })} dense aria-label="새 차수 추가">
          + 차수 추가
        </Button>
      </div>
      {openLotsQuery.isPending || rows.length === 0 ? (
        <EmptyState dense title={openLotsQuery.isPending ? '로드 중…' : 'OPEN 차수 없음'} />
      ) : (
        <TableGrid.Root
          aria-label="수동편집 OPEN 차수"
          variant="hts"
          horizontalScroll
          style={{ height: 'auto', fontSize: '0.95rem' }}
        >
          <TableGrid.Header>
            <TableGrid.Cell width="6.4rem" numeric>
              차수
            </TableGrid.Cell>
            <TableGrid.Cell width="7.6rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="10.4rem" numeric>
              매입가
            </TableGrid.Cell>
            <TableGrid.Cell width="8.6rem" numeric>
              수량
            </TableGrid.Cell>
            <TableGrid.Cell width="11rem" numeric>
              금액
            </TableGrid.Cell>
            <TableGrid.Cell width="11.6rem" className="date-time-cell">
              매수일
            </TableGrid.Cell>
            <TableGrid.Cell width="15.6rem" align="right" sticky="right">
              액션
            </TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {rows.map((r) => (
              <TableGrid.Row key={r.id}>
                <TableGrid.Cell width="6.4rem" numeric>
                  {r.nth}차
                </TableGrid.Cell>
                <TableGrid.Cell width="7.6rem">{r.status}</TableGrid.Cell>
                <TableGrid.Cell width="10.4rem" numeric>
                  {r.buyPrice.toLocaleString()}
                </TableGrid.Cell>
                <TableGrid.Cell width="8.6rem" numeric>
                  {r.qty.toLocaleString()}
                </TableGrid.Cell>
                <TableGrid.Cell width="11rem" numeric>
                  {r.amountKrw.toLocaleString()}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width="11.6rem"
                  className="muted date-time-cell"
                  title={formatDateTimeLongKo(r.boughtAtMs)}
                >
                  {formatDateOnly(r.boughtAtMs)}
                </TableGrid.Cell>
                <TableGrid.Cell width="15.6rem" sticky="right">
                  <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                    <Button onClick={() => setModal({ kind: 'edit', row: r })} dense>
                      수정
                    </Button>
                    <Button onClick={() => setModal({ kind: 'move', row: r })} dense>
                      이동
                    </Button>
                    <Button
                      onClick={() => {
                        void onConfirmDelete(r);
                      }}
                      dense
                    >
                      삭제
                    </Button>
                  </div>
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
          </TableGrid.Body>
        </TableGrid.Root>
      )}
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
      {modal.kind === 'move' && (
        <MoveLotModal
          row={modal.row}
          onConfirm={(newNth) => {
            void onConfirmMove(modal.row, newNth);
          }}
          onCancel={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  );
};

const MoveLotModal = ({
  row,
  onConfirm,
  onCancel,
}: {
  row: LotRowVm;
  onConfirm: (newNth: number) => void;
  onCancel: () => void;
}): ReactElement => {
  const [newNth, setNewNth] = useState(String(row.nth));
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="차수 이동">
      <div className="modal panel">
        <div className="panel__title">{row.nth}차 → 다른 차수로 이동</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.6rem' }}>
          <label htmlFor="move-new-nth" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">새 차수 번호</span>
            <NumberInput
              id="move-new-nth"
              value={newNth}
              onValueChange={setNewNth}
              min="1"
              dense
              autoFocus
            />
          </label>
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onCancel} dense>
            취소
          </Button>
          <Button onClick={() => onConfirm(Number(newNth))} variant="primary" dense>
            이동
          </Button>
        </div>
      </div>
    </div>
  );
};
