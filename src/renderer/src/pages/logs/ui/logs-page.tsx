import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Button, Select, TableGrid, useTableGridVirtual } from '@renderer/shared/ui';
import {
  type Dispatch,
  memo,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  buildLogPayloadPreview,
  buildLogPayloadView,
  type LogPayloadPreview,
} from '../lib/log-payload';
import { LOG_CATEGORIES, LOG_LEVELS, type LogEntry, useLogTail } from '../model/use-log-tail';

const LOG_TABLE_COLUMN_WIDTHS = {
  timestamp: 200,
  level: 88,
  category: 104,
  message: 360,
  payload: 720,
} as const;

const LOG_TABLE_TOTAL_WIDTH = Object.values(LOG_TABLE_COLUMN_WIDTHS).reduce(
  (sum, width) => sum + width,
  0,
);
const LOG_DETAIL_PANEL_HEIGHT = '19.6rem';
const LOG_TS_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const LOG_TS_CACHE_LIMIT = 600;
const logTsCache = new Map<number, string>();

type SelectLogEntry = Dispatch<SetStateAction<LogEntry['id'] | null>>;

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
    exportPending,
    exportLogs,
  } = useLogTail();
  const [isPending_, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<LogEntry['id'] | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const handleCategoryToggle = (cat: (typeof LOG_CATEGORIES)[number]) => {
    if (!cat) return;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useTableGridVirtual({
    count: entries.length,
    estimateSize: () => 26,
    parentRef: scrollRef,
    overscan: 12,
  });

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedId(null);
      return;
    }

    if (selectedId !== null && entries.some((entry) => entry.id === selectedId)) {
      return;
    }

    setSelectedId(entries[0]?.id ?? null);
  }, [entries, selectedId]);

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedPayload = buildLogPayloadView(selectedEntry?.payloadJson ?? null);
  const selectedSummary = selectedEntry
    ? `${selectedEntry.category} · ${formatTs(selectedEntry.ts)}`
    : '로그를 선택하면 아래 상세 카드에서 payload를 확인할 수 있습니다.';
  const statusText =
    actionMessage || '행을 선택하면 아래에서 payload를 정렬된 JSON으로 확인할 수 있습니다.';

  const handleExport = async (format: 'csv' | 'json'): Promise<void> => {
    const result = await exportLogs(format);
    if (result.canceled) {
      setActionMessage(`${format.toUpperCase()} 저장이 취소되었습니다.`);
      return;
    }

    setActionMessage(
      `${result.filename ?? `${format}.tmp`} 저장 완료 · ${thousandSeparator(result.count ?? 0)}건`,
    );
  };

  const handleCopyPayload = async (): Promise<void> => {
    if (!selectedEntry?.payloadJson) {
      setActionMessage('복사할 payload 가 없습니다.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setActionMessage('이 환경에서는 클립보드 복사를 사용할 수 없습니다.');
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedPayload.pretty);
      setActionMessage('payload 복사 완료');
    } catch (error) {
      setActionMessage(
        `payload 복사 실패: ${error instanceof Error ? error.message : '알 수 없음'}`,
      );
    }
  };

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
      <div
        className="panel__body"
        style={{
          display: 'flex',
          gap: '0.8rem',
          alignItems: 'end',
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
            {LOG_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item || '전체'}
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
            placeholder="메시지 / payload 검색..."
            value={search}
            onChange={(e) =>
              startTransition(() => {
                setSearch(e.target.value);
              })
            }
            style={{ padding: '0.4rem', fontSize: '0.9rem' }}
          />
        </label>

        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            alignItems: 'center',
            marginLeft: 'auto',
            flexWrap: 'wrap',
          }}
        >
          <span className="muted">{thousandSeparator(entries.length)}건 표시</span>
          <Button dense onClick={() => handleExport('csv')} disabled={exportPending}>
            CSV 저장
          </Button>
          <Button dense onClick={() => handleExport('json')} disabled={exportPending}>
            JSON 저장
          </Button>
        </div>
      </div>

      <div
        className="panel__body"
        style={{
          display: 'grid',
          gap: '0.65rem',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span className="muted">카테고리:</span>
          {LOG_CATEGORIES.filter((category) => category !== '').map((cat) => (
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
                transition: 'background-color 160ms ease, border-color 160ms ease',
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
        <div
          aria-live="polite"
          style={{
            alignItems: 'center',
            background:
              'linear-gradient(180deg, var(--bg-2, rgba(0,0,0,0.03)) 0%, var(--bg-3, rgba(0,0,0,0.05)) 100%)',
            border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
            borderRadius: '0.45rem',
            display: 'flex',
            minHeight: '2.8rem',
            overflow: 'hidden',
            padding: '0 0.8rem',
          }}
        >
          <div
            style={{
              color: 'var(--fg-2)',
              fontSize: '1.02rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: '100%',
            }}
          >
            {statusText}
          </div>
        </div>
      </div>

      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="이벤트 로그"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.timestamp} numeric>
            시각
          </TableGrid.Cell>
          <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>레벨</TableGrid.Cell>
          <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>카테고리</TableGrid.Cell>
          <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.message} overflow="ellipsis">
            메시지
          </TableGrid.Cell>
          <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.payload} overflow="ellipsis">
            payload 요약
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body scrollRef={scrollRef}>
          {error ? (
            <TableGrid.Row>
              <TableGrid.Cell width={LOG_TABLE_TOTAL_WIDTH}>
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
            <div
              style={{
                height: virtual.totalSize,
                minWidth: '100%',
                position: 'relative',
                width: LOG_TABLE_TOTAL_WIDTH,
              }}
            >
              {virtual.items.map((vItem) => {
                const entry = entries[vItem.index];
                if (!entry) return null;

                return (
                  <LogTableRow
                    key={entry.id}
                    category={entry.category}
                    index={vItem.index}
                    isSelected={selectedId === entry.id}
                    level={entry.level}
                    message={entry.message}
                    measureElement={virtual.measureElement}
                    onSelect={setSelectedId}
                    payload={buildLogPayloadPreview(entry.payloadJson)}
                    rowId={entry.id}
                    timestampLabel={formatTs(entry.ts)}
                    top={vItem.start}
                  />
                );
              })}
            </div>
          ) : null}
        </TableGrid.Body>
      </TableGrid.Root>

      <div
        className="panel__body"
        style={{
          borderTop: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.8rem',
          flexShrink: 0,
          minHeight: LOG_DETAIL_PANEL_HEIGHT,
        }}
      >
        <div
          style={{
            alignItems: 'center',
            display: 'grid',
            gap: '0.8rem',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            minHeight: '2.8rem',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              gap: '0.5rem',
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <span className="muted" style={{ flexShrink: 0 }}>
              선택 로그
            </span>
            {selectedEntry ? (
              <span className={levelClass(selectedEntry.level)}>{selectedEntry.level}</span>
            ) : null}
            <span
              style={{
                color: 'var(--fg-2)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedSummary}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button dense onClick={handleCopyPayload} disabled={!selectedEntry?.payloadJson}>
              payload 복사
            </Button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            flex: 1,
            gap: '0.8rem',
            gridTemplateColumns: 'minmax(0, 0.92fr) minmax(0, 1.08fr)',
            minHeight: 0,
          }}
        >
          <LogDetailCard label="message">{selectedEntry?.message ?? '-'}</LogDetailCard>
          <LogDetailCard label="payload" mono preformatted>
            {selectedPayload.pretty}
          </LogDetailCard>
        </div>
      </div>
    </div>
  );
};

const LogTableRow = memo(function LogTableRow(props: {
  category: string;
  index: number;
  isSelected: boolean;
  level: string;
  message: string;
  measureElement: (el: Element | null) => void;
  onSelect: SelectLogEntry;
  payload: LogPayloadPreview;
  rowId: LogEntry['id'];
  timestampLabel: string;
  top: number;
}): ReactElement {
  const {
    category,
    index,
    isSelected,
    level,
    message,
    measureElement,
    onSelect,
    payload,
    rowId,
    timestampLabel,
    top,
  } = props;

  return (
    <TableGrid.Row
      ref={measureElement}
      data-index={index}
      data-key={String(rowId)}
      onClick={() => onSelect(rowId)}
      selected={isSelected}
      style={{
        left: 0,
        position: 'absolute',
        right: 0,
        top,
      }}
    >
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.timestamp} numeric>
        {timestampLabel}
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.level}>
        <span className={levelClass(level)}>{level}</span>
      </TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.category}>{category}</TableGrid.Cell>
      <TableGrid.Cell width={LOG_TABLE_COLUMN_WIDTHS.message} overflow="ellipsis" title={message}>
        {message}
      </TableGrid.Cell>
      <TableGrid.Cell
        width={LOG_TABLE_COLUMN_WIDTHS.payload}
        overflow="ellipsis"
        {...(payload.summary === '-' ? {} : { title: payload.summary })}
      >
        <PayloadSummary payload={payload} />
      </TableGrid.Cell>
    </TableGrid.Row>
  );
});

function LogDetailCard(props: {
  children: string;
  label: string;
  mono?: boolean;
  preformatted?: boolean;
}): ReactElement {
  const { children, label, mono = false, preformatted = false } = props;

  return (
    <section
      style={{
        background:
          'linear-gradient(180deg, var(--bg, #fff) 0%, var(--bg-2, rgba(0,0,0,0.03)) 100%)',
        border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
        borderRadius: '0.55rem',
        boxShadow: 'inset 0 -0.1rem 0 var(--border, rgba(0,0,0,0.08))',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        minHeight: '14.6rem',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          background: 'var(--bg-3, rgba(0,0,0,0.04))',
          borderBottom: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
          color: 'var(--fg-2)',
          display: 'flex',
          fontSize: '1rem',
          minHeight: '2.8rem',
          padding: '0 0.9rem',
        }}
      >
        {label}
      </div>
      <div
        style={{
          minHeight: 0,
          overflow: 'auto',
          padding: '0.9rem',
          position: 'relative',
        }}
      >
        <div
          style={{
            color: 'var(--fg)',
            fontFamily: mono ? 'var(--mono, monospace)' : 'inherit',
            fontSize: mono ? '1.02rem' : '1.05rem',
            lineHeight: 1.5,
            minHeight: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {preformatted ? (
            <pre style={{ margin: 0, whiteSpace: 'inherit' }}>{children}</pre>
          ) : (
            children
          )}
        </div>
      </div>
    </section>
  );
}

function PayloadSummary({ payload }: { payload: LogPayloadPreview }): ReactElement {
  if (payload.chips.length === 0) {
    return (
      <span className="muted" style={{ fontFamily: 'var(--mono, monospace)', fontSize: '1.05rem' }}>
        {payload.summary}
      </span>
    );
  }

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: '0.35rem',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {payload.chips.map((chip) => (
        <span
          key={chip.key}
          style={{
            background: 'var(--bg-3, rgba(0,0,0,0.06))',
            border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
            borderRadius: '999px',
            color: 'var(--fg-2)',
            display: 'inline-flex',
            fontFamily: 'var(--mono, monospace)',
            fontSize: '1rem',
            gap: '0.25rem',
            maxWidth: '18rem',
            minWidth: 0,
            overflow: 'hidden',
            padding: '0.08rem 0.5rem',
          }}
        >
          <strong style={{ flexShrink: 0 }}>{chip.key}</strong>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.value}</span>
        </span>
      ))}
      {payload.hiddenCount > 0 ? (
        <span className="muted" style={{ flexShrink: 0 }}>
          +{payload.hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function formatTs(ts: Date | number | string): string {
  const date = ts instanceof Date ? ts : new Date(ts);
  const time = date.getTime();
  if (Number.isNaN(time)) return '-';

  const cached = logTsCache.get(time);
  if (cached) {
    return cached;
  }

  const next = LOG_TS_FORMATTER.format(date);
  logTsCache.set(time, next);
  if (logTsCache.size > LOG_TS_CACHE_LIMIT) {
    const oldestKey = logTsCache.keys().next().value;
    if (oldestKey !== undefined) {
      logTsCache.delete(oldestKey);
    }
  }
  return next;
}

function levelClass(level: string): string {
  if (level === 'ERROR') return 'chip chip--down';
  if (level === 'WARN') return 'chip';
  return 'chip chip--up';
}
