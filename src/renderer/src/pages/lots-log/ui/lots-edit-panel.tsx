import {
  BulkPriceRatioForm,
  CsvImportDialog,
  EditLotsGrid,
  UndoButton,
  type useEditLots,
} from '@renderer/features/edit-lots-manual';
import type { Dispatch, ReactElement, SetStateAction } from 'react';

interface LotsEditPanelProps {
  accountId: number | null;
  csvOpen: boolean;
  editLots: ReturnType<typeof useEditLots>;
  editPdnoInput: string;
  onEditPdnoInputChange: (value: string) => void;
  setCsvOpen: Dispatch<SetStateAction<boolean>>;
}

export const LotsEditPanel = ({
  accountId,
  csvOpen,
  editLots,
  editPdnoInput,
  onEditPdnoInputChange,
  setCsvOpen,
}: LotsEditPanelProps): ReactElement | null => {
  if (!editLots.mode || accountId === null) return null;

  return (
    <div
      style={{
        padding: '0.8rem',
        borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
        background: 'var(--hts-accent-bg, #fff3e0)',
        display: 'grid',
        gap: '0.6rem',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>수동편집 모드</strong>
        <input
          type="text"
          value={editPdnoInput}
          onChange={(event) => onEditPdnoInputChange(event.target.value)}
          placeholder="대상 종목 6자리 (예: 005930)"
          maxLength={6}
          style={{
            fontSize: '1rem',
            padding: '0.2rem 0.4rem',
            border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
            borderRadius: 3,
          }}
          aria-label="수동편집 대상 종목코드"
        />
        {editLots.pdno ? (
          <>
            <button
              type="button"
              onClick={() => setCsvOpen(true)}
              style={{
                padding: '0.25rem 0.6rem',
                cursor: 'pointer',
                border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
                borderRadius: 3,
                background: 'transparent',
              }}
            >
              CSV 임포트…
            </button>
            <UndoButton accountId={accountId} pdno={editLots.pdno} />
          </>
        ) : null}
      </div>
      {editLots.pdno ? (
        <>
          <EditLotsGrid accountId={accountId} pdno={editLots.pdno} />
          <BulkPriceRatioForm accountId={accountId} pdno={editLots.pdno} />
        </>
      ) : null}
      {editLots.lastError ? (
        <div className="chip chip--down" role="alert">
          {editLots.lastError}
        </div>
      ) : null}
      {editLots.pdno ? (
        <CsvImportDialog
          accountId={accountId}
          pdno={editLots.pdno}
          open={csvOpen}
          onClose={() => setCsvOpen(false)}
        />
      ) : null}
    </div>
  );
};
