import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Select, TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import { type ReactElement, useRef, useTransition } from 'react';
import { LOG_CATEGORIES, LOG_LEVELS, useLogTail } from '../model/use-log-tail';

export const LogsPage = (): ReactElement => {
  const {
    level,
    setLevel,
    categories,
    setCategories,
    search,
    setSearch,
    dateRange,
    setDateRange,
    entries,
    error,
    isPending,
  } = useLogTail();
  const [isPending_, startTransition] = useTransition();

  const handleCategoryToggle = (cat: (typeof LOG_CATEGORIES)[number]) => {
    if (!cat) return; // '전체' 필터 무시
    startTransition(() => {
      const newCategories = new Set(categories);
      if (newCategories.has(cat)) {
        newCategories.delete(cat);
      } else {
        newCategories.add(cat);
      }
      setCategories(newCategories);
    });
  };

  // 가상화 setup — 필터 적용된 entries 기준
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: entries.length,
    estimateSize: () => 26,
    parentRef: scrollRef,
    overscan: 12,
  });

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* 필터 행 1: 레벨, 날짜 범위 */}
      <div
        className="panel__body"
        style={{
          display: 'flex',
          gap: '0.8rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <label htmlFor="logs-level" style={{ display: 'grid', gap: '0.25rem' }}>
          <span className="muted">레벨</span>
          <Select
            id="logs-level"
            value={level}
            onChange={(e) =>
              startTransition(() => {
                setLevel(e.target.value as typeof level);
              })
            }
            dense
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l || '전체'}
              </option>
            ))}
          </Select>
        </label>

        <label htmlFor="logs-date-range" style={{ display: 'grid', gap: '0.25rem' }}>
          <span className="muted">기간</span>
          <Select
            id="logs-date-range"
            value={dateRange}
            onChange={(e) =>
              startTransition(() => {
                setDateRange(
                  e.target.value as 'today' | 'month' | 'lastMonth' | 'last3Months' | 'year' | '',
                );
              })
            }
            dense
          >
            <option value="">전체</option>
            <option value="today">오늘</option>
            <option value="month">이번달</option>
            <option value="lastMonth">지난달</option>
            <option value="last3Months">3개월</option>
            <option value="year">1년</option>
          </Select>
        </label>

        <label htmlFor="logs-search" style={{ display: 'grid', gap: '0.25rem' }}>
          <span className="muted">검색</span>
          <input
            id="logs-search"
            type="text"
            placeholder="메시지 검색..."
            value={search}
            onChange={(e) =>
              startTransition(() => {
                setSearch(e.target.value);
              })
            }
            style={{ padding: '0.4rem', fontSize: '0.9rem' }}
          />
        </label>

        <span className="muted" style={{ marginLeft: 'auto' }}>
          {thousandSeparator(entries.length)}건 표시
        </span>
      </div>

      {/* 필터 행 2: 카테고리 multi-select */}
      <div
        className="panel__body"
        style={{
          display: 'flex',
          gap: '0.4rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <span className="muted">카테고리:</span>
        {LOG_CATEGORIES.filter((c) => c !== '').map((cat) => (
          <label
            key={cat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.6rem',
              border: categories.has(cat) ? '1px solid #0f0' : '1px solid #666',
              borderRadius: '0.25rem',
              backgroundColor: categories.has(cat) ? 'rgba(0, 255, 0, 0.1)' : 'transparent',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            <input
              type="checkbox"
              checked={categories.has(cat)}
              onChange={() => handleCategoryToggle(cat)}
              style={{ cursor: 'pointer' }}
            />
            {cat}
          </label>
        ))}
      </div>

      {/* TableGrid + 가상화 */}
      <TableGrid.Root
        variant="hts"
        stickyHeader
        aria-label="이벤트 로그"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={200} numeric>
            시각
          </TableGrid.Cell>
          <TableGrid.Cell width={80}>레벨</TableGrid.Cell>
          <TableGrid.Cell width={96}>카테고리</TableGrid.Cell>
          <TableGrid.Cell flex={2} overflow="ellipsis">
            메시지
          </TableGrid.Cell>
          <TableGrid.Cell flex={3} overflow="ellipsis">
            payload
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body scrollRef={scrollRef}>
          {error ? (
            <TableGrid.Row>
              <TableGrid.Cell flex={1}>
                <span className="chip chip--down">{error.message}</span>
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {isPending || isPending_ ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">로드 중…</TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {!isPending && !isPending_ && !error && entries.length === 0 ? (
            <TableGrid.Row placeholder>
              <TableGrid.Cell className="muted">기록된 로그가 없습니다.</TableGrid.Cell>
            </TableGrid.Row>
          ) : null}
          {entries.length > 0 ? (
            <div style={{ height: virtual.totalSize, position: 'relative', width: '100%' }}>
              {virtual.items.map((vItem) => {
                const e = entries[vItem.index];
                if (!e) return null;
                return (
                  <TableGrid.Row
                    key={e.id}
                    ref={virtual.measureElement}
                    data-key={String(e.id)}
                    style={{
                      position: 'absolute',
                      top: vItem.start,
                      left: 0,
                      right: 0,
                    }}
                  >
                    <TableGrid.Cell width={200} numeric>
                      {formatTs(e.ts)}
                    </TableGrid.Cell>
                    <TableGrid.Cell width={80}>
                      <span className={levelClass(e.level)}>{e.level}</span>
                    </TableGrid.Cell>
                    <TableGrid.Cell width={96}>{e.category}</TableGrid.Cell>
                    <TableGrid.Cell flex={2} overflow="ellipsis" title={e.message}>
                      {e.message}
                    </TableGrid.Cell>
                    <TableGrid.Cell
                      flex={3}
                      overflow="ellipsis"
                      className="muted"
                      style={{ fontFamily: 'monospace', fontSize: '1.05rem' }}
                      title={e.payloadJson ?? ''}
                    >
                      {e.payloadJson ?? ''}
                    </TableGrid.Cell>
                  </TableGrid.Row>
                );
              })}
            </div>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};

function formatTs(ts: Date | number | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { hour12: false });
}

function levelClass(level: string): string {
  if (level === 'ERROR') return 'chip chip--down';
  if (level === 'WARN') return 'chip';
  return 'chip chip--up';
}
