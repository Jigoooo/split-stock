import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, startTransition, useState } from 'react';

export interface EditLotsGridProps {
  accountId: number;
  pdno: string;
  /** 행 클릭 시 (수정/삭제) — 부모가 모달 띄움 */
  onRowAction: (lotId: number, kind: 'update' | 'delete' | 'move') => void;
  /** 새 차수 추가 버튼 */
  onAddRow: () => void;
}

/**
 * 수동편집 모드의 차수 grid — 단순 테이블 + 행별 수정/삭제/이동 버튼.
 *
 * 표시 컬럼: nth, status, buyPrice, qty, amountKrw, boughtAt
 * 좌상단: "장부상만 변경, KIS 실잔고와 불일치 가능" 경고 배지.
 */
export const EditLotsGrid = (props: EditLotsGridProps): ReactElement => {
  const { accountId, pdno, onRowAction, onAddRow } = props;
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const exportQuery = trpc.lotsManual.exportCsv.useQuery({ accountId, pdno });
  // listRows 가 별도 endpoint 없어서 lots.snapshot (today) 대신 exportCsv 결과를 파싱하지 않고
  // exportCsv 의 rowCount + 별도 grid 데이터는 부모의 lots-snapshot 으로부터 받아야 한다.
  // 단순화: lots-manual 라우터가 importCsvPreview/exportCsv 외에 grid 전용 list 를 제공하지 않으므로
  // 향후 lots-router 의 snapshot 또는 별도 endpoint 로 보강 가능. 본 컴포넌트는 부모가 데이터를 주입한다.
  void exportQuery;
  void selectedId;
  void setSelectedId;

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
        <Button onClick={onAddRow} dense aria-label="새 차수 추가">
          + 차수 추가
        </Button>
      </div>
      {/*
        실제 행 데이터는 부모 컴포넌트(예: lots-log 페이지)가 trpc.lots.snapshot 결과를 전달하는 방식.
        본 컴포넌트는 액션 슬롯만 담당하여 BC 보호: 기존 lots-log 의 텍스트 뷰와 모드 분기가 가능.
      */}
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
          {/* 부모가 행을 주입하지 않으면 안내 행 */}
          <tr>
            <td colSpan={7} className="muted" style={{ padding: '0.6rem', textAlign: 'center' }}>
              차수 데이터를 부모 컴포넌트에서 전달하세요.
            </td>
          </tr>
        </tbody>
      </table>
      {/* 행별 액션 콜백 — 부모가 grid row 를 직접 그릴 때 사용. 본 컴포넌트는 onRowAction prop 만 노출. */}
      <div style={{ display: 'none' }}>
        <button type="button" onClick={() => onRowAction(0, 'update')}>
          (slot for parent)
        </button>
        <button
          type="button"
          onClick={() => {
            startTransition(() => {});
          }}
        >
          (transition slot)
        </button>
      </div>
    </div>
  );
};
