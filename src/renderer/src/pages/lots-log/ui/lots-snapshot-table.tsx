import { TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { ClipboardCopy } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import { formatSnapshotBlock } from '../model/format-snapshot-text';
import type { SnapshotRow } from '../model/use-lots-log';

interface LotsSnapshotTableProps {
  selectedDate: string | null;
  snapshots: SnapshotRow[];
  snapshotsLoading: boolean;
}

export const LotsSnapshotTable = ({
  selectedDate,
  snapshots,
  snapshotsLoading,
}: LotsSnapshotTableProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: snapshots.length,
    estimateSize: () => 200,
    parentRef: scrollRef,
    overscan: 5,
  });

  const handleCopyOne = (index: number): void => {
    const row = snapshots[index];
    if (!row) return;
    void navigator.clipboard.writeText(formatSnapshotBlock(row));
  };

  return (
    <TableGrid.Root
      variant="plain"
      stickyHeader={false}
      overlayScrollbar
      aria-label="일자별 차수 스냅샷"
      style={{ flex: 1, minHeight: 0 }}
    >
      <TableGrid.Body scrollRef={scrollRef}>
        {snapshotsLoading ? (
          <div className="muted" style={{ padding: '1rem' }}>
            로드 중…
          </div>
        ) : snapshots.length === 0 ? (
          <div className="muted" style={{ padding: '1rem' }}>
            {selectedDate ? '해당 일자 데이터 없음' : '날짜를 선택하세요'}
          </div>
        ) : (
          <div style={{ height: virtual.totalSize, position: 'relative', width: '100%' }}>
            {virtual.items.map((vItem) => {
              const row = snapshots[vItem.index];
              if (!row) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtual.measureElement}
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
                      {formatSnapshotBlock(row)}
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
      </TableGrid.Body>
    </TableGrid.Root>
  );
};
