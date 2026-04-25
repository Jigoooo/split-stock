import type { WatchHistoryItem } from '@renderer/entities/watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { type ReactElement, useMemo } from 'react';

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

  if (error) {
    return (
      <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
        {error.message}
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="muted" style={{ padding: '0.8rem' }}>
        히스토리 로드 중…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="muted" style={{ padding: '0.8rem' }}>
        히스토리 없음
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem', padding: '0.3rem 0.1rem', overflow: 'auto' }}>
      {items.map((item) => (
        <WatchHistoryRow
          key={item.id}
          item={item}
          stockName={resolveStockName(item, stockNameByPdno)}
        />
      ))}
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
  <article
    style={{
      display: 'grid',
      gap: '0.4rem',
      padding: '0.7rem 0.85rem',
      border: '1px solid var(--border)',
      borderRadius: '0.55rem',
      background: 'var(--bg)',
    }}
  >
    <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <strong>{historyLabel(item.message)}</strong>
      <span className={levelClassName(item.level)}>{levelLabel(item.level)}</span>
      {item.source ? <span className="chip">{sourceLabel(item.source)}</span> : null}
      <span className="muted" style={{ marginLeft: 'auto' }}>
        {formatDate(item.at)}
      </span>
    </div>
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {item.pdno ? (
        <>
          <span style={{ fontWeight: 700 }}>{stockName ?? item.pdno}</span>
          <span className="num muted">{item.pdno}</span>
        </>
      ) : (
        <span className="muted">전체 자동감시</span>
      )}
      {item.watchId ? <span className="muted">#{item.watchId}</span> : null}
    </div>
    {item.reason ? <div className="muted">{item.reason}</div> : null}
  </article>
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

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', { hour12: false });
}
