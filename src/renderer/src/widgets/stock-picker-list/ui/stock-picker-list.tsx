import { trpc } from '@renderer/shared/api/trpc';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { StockListEntry } from '../model/use-stock-list';
import { useStockList } from '../model/use-stock-list';

const ROW_HEIGHT_PX = 36;

export interface StockPickerListProps {
  selectedPdno?: string;
  onSelect: (entry: StockListEntry) => void;
  height?: number;
}

/**
 * 종목 마스터 전체를 TanStack Virtual로 무한스크롤 표시.
 * - 검색창 입력 → debounce 후 서버 필터
 * - 하단 근접 시 자동 다음 페이지 fetch
 * - 마스터 DB가 비어있으면 "동기화" 버튼 노출
 */
export const StockPickerList = (props: StockPickerListProps): ReactElement => {
  const { selectedPdno, onSelect, height = 420 } = props;
  const [keyword, setKeyword] = useState('');
  const list = useStockList(keyword);
  const status = trpc.market.getStockMasterStatus.useQuery();
  const utils = trpc.useUtils();
  const syncMutation = trpc.market.syncStockMaster.useMutation({
    onSuccess: async () => {
      await utils.market.listStock.invalidate();
      status.refetch();
    },
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: list.entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastVisibleIndex < 0) return;
    if (lastVisibleIndex >= list.entries.length - 10 && list.hasNextPage) {
      list.fetchNextPage();
    }
  }, [lastVisibleIndex, list.entries.length, list.hasNextPage, list.fetchNextPage]);

  const totalText =
    list.total > 0
      ? `${list.entries.length.toLocaleString('ko-KR')} / ${list.total.toLocaleString('ko-KR')}`
      : '';

  const isEmpty = !list.isLoading && status.data?.total === 0;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        className="panel__title"
        style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}
      >
        <span>종목 목록</span>
        {totalText ? <span className="muted">{totalText}</span> : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hts-btn"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
          aria-label="종목 마스터 다시 동기화"
        >
          {syncMutation.isPending ? '동기화 중…' : '다시 동기화'}
        </button>
      </div>
      <div
        className="panel__body"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
      >
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="종목명 또는 6자리 코드"
          aria-label="종목 목록 검색"
          style={{ width: '100%' }}
        />
        {syncMutation.error ? (
          <span className="chip chip--down">{syncMutation.error.message}</span>
        ) : null}
        {isEmpty ? (
          <div className="muted" style={{ padding: '1.2rem' }}>
            종목 마스터가 비어 있습니다. 위 "다시 동기화" 버튼으로 받아오세요.
          </div>
        ) : list.error ? (
          <span className="chip chip--down">{list.error.message}</span>
        ) : (
          <div
            ref={parentRef}
            role="listbox"
            aria-label="종목 목록"
            style={{
              height,
              overflowY: 'auto',
              border: '1px solid var(--hts-line, rgba(0,0,0,0.12))',
              borderRadius: 4,
              position: 'relative',
            }}
          >
            {list.isLoading ? (
              <div className="muted" style={{ padding: '1.2rem' }}>
                로딩 중…
              </div>
            ) : list.entries.length === 0 ? (
              <div className="muted" style={{ padding: '1.2rem' }}>
                결과 없음
              </div>
            ) : (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map((vi) => {
                  const entry = list.entries[vi.index];
                  if (!entry) return null;
                  const isSelected = entry.pdno === selectedPdno;
                  return (
                    <button
                      type="button"
                      key={entry.pdno}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => onSelect(entry)}
                      className={isSelected ? 'hts-btn hts-btn--primary' : 'hts-btn'}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        transform: `translateY(${vi.start}px)`,
                        width: '100%',
                        height: ROW_HEIGHT_PX,
                        display: 'flex',
                        gap: '0.8rem',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        borderRadius: 0,
                        textAlign: 'left',
                        padding: '0 0.8rem',
                      }}
                    >
                      <span className="num" style={{ minWidth: '6rem' }}>
                        {entry.pdno}
                      </span>
                      <span style={{ flex: 1 }}>{entry.name}</span>
                      {entry.sector ? <span className="muted">{entry.sector}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
