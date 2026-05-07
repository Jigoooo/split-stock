import type { WatchHistoryItem } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { formatStockLabel } from '@renderer/shared/lib/formatter';
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
        <span style={{ fontWeight: 700 }}>{formatStockLabel(stockName, item.pdno)}</span>
      ) : (
        <span className="muted">전체 자동감시</span>
      )}
    </TableGrid.Cell>
    <TableGrid.Cell width="9rem">
      {item.source ? sourceLabel(item.source, item.message) : '-'}
    </TableGrid.Cell>
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
    // auto-crypto.{kind}.{action} — cryptoEventToWatchHistoryItem 에서 생성
    case 'auto-crypto.dry-run.buy':
      return '드라이런 매수';
    case 'auto-crypto.dry-run.sell':
      return '드라이런 매도';
    case 'auto-crypto.live.buy':
      return '실거래 매수';
    case 'auto-crypto.live.sell':
      return '실거래 매도';
    case 'auto-crypto.blocked.buy':
      return '매수 차단';
    case 'auto-crypto.blocked.sell':
      return '매도 차단';
    case 'auto-crypto.decimal-error.buy':
      return '수량 오류(매수)';
    case 'auto-crypto.decimal-error.sell':
      return '수량 오류(매도)';
    case 'auto-crypto.config.update':
      return '설정 변경';
    default:
      // auto-crypto.* 미분류 케이스 — kind.action 부분만 노출
      if (message.startsWith('auto-crypto.')) {
        return message.slice('auto-crypto.'.length);
      }
      return message;
  }
}

function sourceLabel(source: NonNullable<WatchHistoryItem['source']>, message?: string): string {
  // auto-crypto 이벤트는 source='CUSTOM' 이지만 "예약매수" 가 아닌 "코인 자동매매" 로 표시
  if (message?.startsWith('auto-crypto.')) return '코인 자동매매';
  switch (source) {
    case 'BOOSTER':
      return '구버전';
    case 'PREBUY':
    case 'CUSTOM':
      return '예약매수';
  }
}
