import { Button, useTableGridVirtual } from '@renderer/shared/ui';
import {
  memo,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { formatLogTs, LOG_TABLE_ROW_ESTIMATE, levelClass } from '../config/log-table';
import { buildLogPayloadPreview } from '../lib/log-payload';
import { groupLogEntries } from '../model/group-log-entries';
import type { LogEntry } from '../model/use-log-tail';
import { PayloadSummary } from './payload-summary';

interface LogsStreamProps {
  entries: LogEntry[];
  error: { message: string } | null;
  isFilterSettling: boolean;
  isPending: boolean;
  onSelect: (id: LogEntry['id']) => void;
  selectedId: LogEntry['id'] | null;
}

export const LogsStream = memo(function LogsStream({
  entries,
  error,
  isFilterSettling,
  isPending,
  onSelect,
  selectedId,
}: LogsStreamProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [shouldFollow, setShouldFollow] = useState(true);
  const orderedEntries = useMemo(() => [...entries].reverse(), [entries]);
  const groups = useMemo(() => groupLogEntries(orderedEntries, 'asc'), [orderedEntries]);
  const getItemKey = useCallback((index: number) => groups[index]?.key ?? index, [groups]);
  const virtual = useTableGridVirtual({
    count: groups.length,
    estimateSize: () => LOG_TABLE_ROW_ESTIMATE,
    getItemKey,
    parentRef: scrollRef,
    overscan: 12,
    useFlushSync: false,
  });

  const updateFollowState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setShouldFollow(distanceFromBottom <= 48);
  }, []);

  useLayoutEffect(() => {
    if (!shouldFollow || entries.length === 0) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [entries.length, shouldFollow]);

  const moveToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setShouldFollow(true);
  }, []);

  return (
    <section className="logs-stream" aria-label="실시간 이벤트 로그 영역">
      <div className="logs-stream__status-row">
        <span className="muted">
          {isFilterSettling ? '필터 반영 중...' : '실시간 로그'}
          {isPending && entries.length === 0 ? ' 불러오는 중...' : ''}
        </span>
        {!shouldFollow && groups.length > 0 ? (
          <Button dense onClick={moveToLatest}>
            최신 로그로 이동
          </Button>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="logs-stream__body"
        role="log"
        aria-live="polite"
        aria-label="실시간 이벤트 로그"
        onScroll={updateFollowState}
      >
        {error ? <div className="logs-stream__error chip chip--down">{error.message}</div> : null}
        {!isPending && !error && groups.length === 0 ? (
          <div className="logs-stream__empty muted">기록된 로그가 없습니다.</div>
        ) : null}
        {groups.length > 0 ? (
          <div className="logs-stream__virtual" style={{ height: virtual.totalSize }}>
            {virtual.items.map((vItem) => {
              const group = groups[vItem.index];
              if (!group) return null;
              const entry = group.latest;
              const payload = buildLogPayloadPreview(entry.payloadJson);
              const timestampLabel = formatLogTs(group.newestTs);
              const timestampTitle =
                group.count > 1
                  ? `${formatLogTs(group.oldestTs)} - ${formatLogTs(group.newestTs)}`
                  : timestampLabel;

              return (
                <button
                  key={vItem.key}
                  type="button"
                  className="logs-stream__row"
                  data-selected={selectedId === entry.id}
                  ref={virtual.measureElement}
                  data-index={vItem.index}
                  onClick={() => onSelect(entry.id)}
                  style={{ top: vItem.start }}
                  title={`${timestampTitle} · ${entry.category} · ${entry.message}`}
                >
                  <span className="logs-stream__timestamp">{timestampLabel}</span>
                  <span className={levelClass(entry.level)}>{entry.level}</span>
                  <span className="logs-stream__category">{entry.category}</span>
                  <span className="logs-stream__message">
                    {entry.message}
                    {group.count > 1 ? (
                      <span className="logs-repeat-badge">x{group.count}</span>
                    ) : null}
                  </span>
                  <PayloadSummary payload={payload} />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
});
