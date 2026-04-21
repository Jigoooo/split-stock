import type { WatchHistoryItem } from '@renderer/entities/watch-order';
import type { ReactElement } from 'react';

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
        <article
          key={item.id}
          style={{
            display: 'grid',
            gap: '0.2rem',
            padding: '0.7rem 0.85rem',
            border: '1px solid var(--border)',
            borderRadius: '0.55rem',
            background: 'var(--bg)',
          }}
        >
          <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{historyLabel(item.message)}</strong>
            {item.source ? <span className="chip">{sourceLabel(item.source)}</span> : null}
            {item.pdno ? <span className="num muted">{item.pdno}</span> : null}
            <span className="muted" style={{ marginLeft: 'auto' }}>
              {formatDate(item.at)}
            </span>
          </div>
          {item.reason ? <div className="muted">{item.reason}</div> : null}
        </article>
      ))}
    </div>
  );
};

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
      return '수익부스터';
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
