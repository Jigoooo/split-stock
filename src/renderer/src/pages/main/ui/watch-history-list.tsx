import type { WatchHistoryItem } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { TableGrid } from '@renderer/shared/ui';
import { type ReactElement, useMemo } from 'react';
import { formatWatchDate, formatWatchDateTitle } from '../lib/watch-list-format';

export interface WatchHistoryListProps {
  items: WatchHistoryItem[];
  isPending: boolean;
  error: { message: string } | null;
}

export const WatchHistoryList = ({
  items,
  isPending,
  error,
}: WatchHistoryListProps): ReactElement => {
  const stockMaster = trpc.market.listAllStock.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const stockNameByPdno = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of stockMaster.data?.entries ?? []) {
      map.set(entry.pdno, entry.name);
    }
    return map;
  }, [stockMaster.data?.entries]);

  return (
    <div className="watch-table-shell">
      <div className="watch-table-toolbar" role="toolbar" aria-label="자동감시 히스토리 요약">
        <span className="watch-table-toolbar__count">히스토리</span>
        <span className="muted watch-table-toolbar__hint">{items.length}건</span>
      </div>
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="자동감시 히스토리"
        className="watch-history-table"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width="17.6rem" className="date-time-cell">
            시각
          </TableGrid.Cell>
          <TableGrid.Cell width="7.6rem">레벨</TableGrid.Cell>
          <TableGrid.Cell width="10.8rem">이벤트</TableGrid.Cell>
          <TableGrid.Cell width="16rem">종목</TableGrid.Cell>
          <TableGrid.Cell width="9rem">출처</TableGrid.Cell>
          <TableGrid.Cell width="8.8rem" numeric>
            Watch ID
          </TableGrid.Cell>
          <TableGrid.Cell width="36rem">사유</TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {error ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell>
                <span className="chip chip--down" role="alert">
                  {error.message}
                </span>
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : isPending ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">히스토리 로드 중…</TableGrid.Cell>
            </TableGrid.Row>
          ) : items.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">히스토리 없음</TableGrid.Cell>
            </TableGrid.Row>
          ) : (
            items.map((item) => (
              <WatchHistoryRow
                key={item.id}
                item={item}
                stockName={resolveStockName(item, stockNameByPdno)}
              />
            ))
          )}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};

const WatchHistoryRow = ({
  item,
  stockName,
}: {
  item: WatchHistoryItem;
  stockName: string | null;
}): ReactElement => (
  <TableGrid.Row>
    <TableGrid.Cell
      width="17.6rem"
      className="muted date-time-cell"
      title={formatWatchDateTitle(item.at)}
    >
      {formatWatchDate(item.at)}
    </TableGrid.Cell>
    <TableGrid.Cell width="7.6rem">
      <span className={levelClassName(item.level)}>{levelLabel(item.level)}</span>
    </TableGrid.Cell>
    <TableGrid.Cell width="10.8rem">{historyLabel(item.message)}</TableGrid.Cell>
    <TableGrid.Cell width="16rem" {...(item.pdno ? { title: item.pdno } : {})}>
      {item.pdno ? (
        <span style={{ display: 'inline-flex', gap: '0.45rem', minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>{stockName ?? item.pdno}</span>
          <span className="num muted">{item.pdno}</span>
        </span>
      ) : (
        <span className="muted">전체 자동감시</span>
      )}
    </TableGrid.Cell>
    <TableGrid.Cell width="9rem">{item.source ? sourceLabel(item.source) : '-'}</TableGrid.Cell>
    <TableGrid.Cell width="8.8rem" numeric>
      {item.watchId ? `#${item.watchId}` : '-'}
    </TableGrid.Cell>
    <TableGrid.Cell
      width="36rem"
      className="muted"
      overflow="ellipsis"
      {...(item.reason ? { title: item.reason } : {})}
    >
      {item.reason ?? '-'}
    </TableGrid.Cell>
  </TableGrid.Row>
);

function resolveStockName(
  item: WatchHistoryItem,
  stockNameByPdno: Map<string, string>,
): string | null {
  if (!item.pdno) return null;
  return stockNameByPdno.get(item.pdno) ?? null;
}

function levelClassName(level: WatchHistoryItem['level']): string {
  switch (level) {
    case 'ERROR':
      return 'chip chip--down';
    case 'WARN':
      return 'chip';
    case 'INFO':
      return 'chip chip--up';
  }
}

function levelLabel(level: WatchHistoryItem['level']): string {
  switch (level) {
    case 'ERROR':
      return '오류';
    case 'WARN':
      return '주의';
    case 'INFO':
      return '정보';
  }
}

function historyLabel(message: string): string {
  switch (message) {
    case 'watch.created':
      return '등록';
    case 'watch.updated':
      return '수정';
    case 'watch.paused':
      return '일시중지';
    case 'watch.resumed':
      return '재개';
    case 'watch.executed':
      return '실행';
    case 'watch.failed':
      return '실패';
    case 'watch.expired':
      return '만료';
    case 'watch.cancelled':
      return '삭제';
    case 'watch.legacy.quarantined':
      return '구버전 자동감시 종료';
    case 'watch.global.on':
      return '전역 자동감시 ON';
    case 'watch.global.off':
      return '전역 자동감시 OFF';
    default:
      return message;
  }
}

function sourceLabel(source: NonNullable<WatchHistoryItem['source']>): string {
  switch (source) {
    case 'BOOSTER':
      return '구버전';
    case 'PREBUY':
    case 'CUSTOM':
      return '예약매수';
  }
}
