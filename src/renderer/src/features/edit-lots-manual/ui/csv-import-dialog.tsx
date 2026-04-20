import { trpc } from '@renderer/shared/api/trpc';
import { Button } from '@renderer/shared/ui';
import { type ReactElement, useState } from 'react';

export interface CsvImportDialogProps {
  accountId: number;
  pdno: string;
  open: boolean;
  onClose: () => void;
  onImported?: (insertedCount: number) => void;
}

/**
 * 차수 CSV 임포트 다이얼로그.
 * 파일 선택 → 미리보기(파싱) → 사용자 승인 → apply.
 */
export const CsvImportDialog = (props: CsvImportDialogProps): ReactElement | null => {
  const { accountId, pdno, open, onClose, onImported } = props;
  const [csvText, setCsvText] = useState('');
  const [previewData, setPreviewData] = useState<{
    validCount: number;
    errorCount: number;
    rows: Array<{ rowIndex: number; ok: boolean; error?: string; raw: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const applyMutation = trpc.lotsManual.importCsvApply.useMutation();

  const onFileChange = async (file: File): Promise<void> => {
    setError(null);
    setPreviewData(null);
    try {
      const text = await file.text();
      setCsvText(text);
      const res = await utils.lotsManual.importCsvPreview.fetch({
        accountId,
        pdno,
        csvText: text,
      });
      setPreviewData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onApply = async (): Promise<void> => {
    if (!previewData || previewData.validCount === 0) return;
    setError(null);
    try {
      const res = await applyMutation.mutateAsync({ accountId, pdno, csvText });
      onImported?.(res.insertedCount);
      setCsvText('');
      setPreviewData(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="CSV 임포트">
      <div className="modal panel">
        <div className="panel__title">차수 CSV 임포트 — {pdno}</div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileChange(f);
            }}
          />
          {error && (
            <div className="chip chip--down" role="alert">
              {error}
            </div>
          )}
          {previewData && (
            <div style={{ fontSize: '0.95rem' }}>
              <div>
                유효 행: <strong>{previewData.validCount}</strong> · 오류 행:{' '}
                <strong style={{ color: previewData.errorCount > 0 ? 'crimson' : undefined }}>
                  {previewData.errorCount}
                </strong>
              </div>
              {previewData.errorCount > 0 && (
                <ul style={{ paddingLeft: '1rem', maxHeight: '12rem', overflowY: 'auto' }}>
                  {previewData.rows
                    .filter((r) => !r.ok)
                    .slice(0, 50)
                    .map((r) => (
                      <li key={r.rowIndex} style={{ color: 'crimson' }}>
                        행 {r.rowIndex}: {r.error}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div
          className="panel__body"
          style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <Button onClick={onClose} dense>
            닫기
          </Button>
          <Button
            onClick={() => {
              void onApply();
            }}
            disabled={!previewData || previewData.validCount === 0 || applyMutation.isPending}
            variant="primary"
            dense
          >
            적용 ({previewData?.validCount ?? 0}건)
          </Button>
        </div>
      </div>
    </div>
  );
};
