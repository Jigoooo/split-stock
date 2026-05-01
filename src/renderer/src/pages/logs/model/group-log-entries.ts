import type { LogEntry } from './use-log-tail';

export interface GroupedLogEntry {
  key: string;
  latest: LogEntry;
  oldestTs: LogEntry['ts'];
  newestTs: LogEntry['ts'];
  count: number;
}

export type LogEntryOrder = 'desc' | 'asc';

const GROUP_WINDOW_MS = 60_000;

function logTime(entry: LogEntry): number {
  if (entry.ts instanceof Date) return entry.ts.getTime();
  if (typeof entry.ts === 'number') return entry.ts;
  return new Date(entry.ts).getTime();
}

function sameGroup(a: LogEntry, b: LogEntry): boolean {
  return (
    a.level === b.level &&
    a.category === b.category &&
    a.message === b.message &&
    (a.payloadJson ?? '') === (b.payloadJson ?? '')
  );
}

function newerEntry(a: LogEntry, b: LogEntry): LogEntry {
  const aTime = logTime(a);
  const bTime = logTime(b);
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return Number(a.id) >= Number(b.id) ? a : b;
}

function olderTs(a: LogEntry['ts'], b: LogEntry['ts']): LogEntry['ts'] {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function newerTs(a: LogEntry['ts'], b: LogEntry['ts']): LogEntry['ts'] {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function groupKey(entry: LogEntry, count: number, order: LogEntryOrder): string {
  return `${order}:${entry.id}:${count}`;
}

export function groupLogEntries(
  entries: readonly LogEntry[],
  order: LogEntryOrder,
): GroupedLogEntry[] {
  const groups: GroupedLogEntry[] = [];
  let previousEntry: LogEntry | null = null;

  for (const entry of entries) {
    const lastGroup = groups.at(-1);
    const previousTime = previousEntry ? logTime(previousEntry) : Number.NaN;
    const currentTime = logTime(entry);
    const withinWindow =
      previousEntry !== null &&
      Number.isFinite(previousTime) &&
      Number.isFinite(currentTime) &&
      Math.abs(currentTime - previousTime) <= GROUP_WINDOW_MS;

    if (lastGroup && previousEntry && withinWindow && sameGroup(previousEntry, entry)) {
      lastGroup.count += 1;
      lastGroup.latest = newerEntry(lastGroup.latest, entry);
      lastGroup.oldestTs = olderTs(lastGroup.oldestTs, entry.ts);
      lastGroup.newestTs = newerTs(lastGroup.newestTs, entry.ts);
      lastGroup.key = groupKey(lastGroup.latest, lastGroup.count, order);
    } else {
      groups.push({
        key: groupKey(entry, 1, order),
        latest: entry,
        oldestTs: entry.ts,
        newestTs: entry.ts,
        count: 1,
      });
    }

    previousEntry = entry;
  }

  return groups;
}
