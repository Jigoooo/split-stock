import { useActiveAccountId } from '@renderer/entities/account';
import {
  BulkPriceRatioForm,
  CsvImportDialog,
  EditLotsGrid,
  EditLotsModeToggle,
  UndoButton,
  useEditLots,
} from '@renderer/features/edit-lots-manual';
import { trpc } from '@renderer/shared/api/trpc';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ClipboardCopy } from 'lucide-react';
import { type ReactElement, useRef, useState } from 'react';
import { formatSnapshotBlock, formatSnapshotsText } from '../model/format-snapshot-text';
import { useLotLog } from '../model/use-lots-log';

export const LotsLogPage = (): ReactElement => {
  const {
    dates,
    datesLoading,
    selectedDate,
    selectDate,
    search,
    setSearch,
    snapshots,
    snapshotsLoading,
  } = useLotLog();
  const editLots = useEditLots();
  const [csvOpen, setCsvOpen] = useState(false);
  const [editPdnoInput, setEditPdnoInput] = useState('');
  const { accountId } = useActiveAccountId();

  // safety master 상태 — 수동편집 모드 진입 가드 결정에 사용.
  const safetyState = trpc.safety.getState.useQuery({}).data;
  const masterSafetyOn = safetyState?.master ?? false;

  const onEnterMode = async (): Promise<void> => {
    if (accountId === null) return;
    await editLots.enterMode(accountId);
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: snapshots.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  const handleCopyAll = (): void => {
    if (!selectedDate) return;
    const text = formatSnapshotsText(selectedDate, snapshots);
    void navigator.clipboard.writeText(text);
  };

  const handleCopyOne = (idx: number): void => {
    const row = snapshots[idx];
    if (!row) return;
    const text = formatSnapshotBlock(row);
    void navigator.clipboard.writeText(text);
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* 좌측: 일자 리스트 */}
      <div
        style={{
          width: '9rem',
          borderRight: '1px solid var(--hts-line, rgba(0,0,0,0.1))',
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '0.5rem 0.6rem',
            fontWeight: 600,
            fontSize: '1.1rem',
            borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
          }}
        >
          일자
        </div>
        {datesLoading ? (
          <div className="muted" style={{ padding: '0.6rem' }}>
            로드 중…
          </div>
        ) : dates.length === 0 ? (
          <div className="muted" style={{ padding: '0.6rem', fontSize: '1.05rem' }}>
            스냅샷 없음
          </div>
        ) : (
          dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => selectDate(d)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.4rem 0.6rem',
                background: d === selectedDate ? 'var(--hts-accent-bg, #e8f0fe)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: d === selectedDate ? 600 : 400,
                fontSize: '1.05rem',
                color: 'var(--hts-text, inherit)',
              }}
            >
              {d}
            </button>
          ))
        )}
      </div>

      {/* 우측: 텍스트 뷰 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 툴바 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.4rem 0.8rem',
            borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="종목코드/종목명 검색"
            style={{
              fontSize: '1.1rem',
              padding: '0.2rem 0.5rem',
              border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
              borderRadius: 3,
              minWidth: '12rem',
            }}
          />
          <span className="muted" style={{ fontSize: '1.05rem' }}>
            {snapshots.length}종목
          </span>
          <button
            type="button"
            onClick={handleCopyAll}
            title="전체 클립보드 복사"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.25rem 0.6rem',
              fontSize: '1.1rem',
              cursor: 'pointer',
              border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
              borderRadius: 3,
              background: 'transparent',
              color: 'var(--hts-text, inherit)',
            }}
          >
            <ClipboardCopy size={13} />
            전체 복사
          </button>
          {/* 수동편집(A7) 토글 — 우측 정렬 */}
          <div style={{ marginLeft: 'auto' }}>
            <EditLotsModeToggle
              accountId={accountId}
              masterSafetyOn={masterSafetyOn}
              active={editLots.mode}
              onEnter={onEnterMode}
              onExit={editLots.exitMode}
              busy={editLots.busy}
            />
          </div>
        </div>

        {/* 수동편집 모드 패널 — active 시에만 표시 */}
        {editLots.mode && accountId !== null && (
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
                onChange={(e) => {
                  const v = e.target.value;
                  setEditPdnoInput(v);
                  if (/^\d{6}$/.test(v)) editLots.setPdno(v);
                  else editLots.setPdno(null);
                }}
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
              {editLots.pdno && (
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
              )}
            </div>
            {editLots.pdno && (
              <>
                <EditLotsGrid accountId={accountId} pdno={editLots.pdno} />
                <BulkPriceRatioForm accountId={accountId} pdno={editLots.pdno} />
              </>
            )}
            {editLots.lastError && (
              <div className="chip chip--down" role="alert">
                {editLots.lastError}
              </div>
            )}
            {editLots.pdno && (
              <CsvImportDialog
                accountId={accountId}
                pdno={editLots.pdno}
                open={csvOpen}
                onClose={() => setCsvOpen(false)}
              />
            )}
          </div>
        )}

        {/* 가상화 스크롤 영역 */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {snapshotsLoading ? (
            <div className="muted" style={{ padding: '1rem' }}>
              로드 중…
            </div>
          ) : snapshots.length === 0 ? (
            <div className="muted" style={{ padding: '1rem' }}>
              {selectedDate ? '해당 일자 데이터 없음' : '날짜를 선택하세요'}
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const row = snapshots[vItem.index];
                if (!row) return null;
                const text = formatSnapshotBlock(row);
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: vItem.start,
                      left: 0,
                      right: 0,
                      padding: '0.6rem 0.8rem',
                      borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.06))',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '0.4rem',
                      }}
                    >
                      <pre
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '1.1rem',
                          whiteSpace: 'pre',
                          margin: 0,
                          flex: 1,
                          minWidth: 0,
                          overflowX: 'auto',
                        }}
                      >
                        {text}
                      </pre>
                      <button
                        type="button"
                        onClick={() => handleCopyOne(vItem.index)}
                        title="이 종목 복사"
                        style={{
                          flexShrink: 0,
                          padding: '0.15rem 0.4rem',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          border: '1px solid var(--hts-line, rgba(0,0,0,0.15))',
                          borderRadius: 3,
                          background: 'transparent',
                          color: 'var(--hts-muted, #666)',
                        }}
                      >
                        <ClipboardCopy size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
