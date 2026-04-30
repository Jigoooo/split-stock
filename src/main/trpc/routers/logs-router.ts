import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { desc, lt } from 'drizzle-orm';
import { z } from 'zod';
import { type CsvColumn, toCsv } from '../../../shared/reporting/csv';
import type { Db } from '../../db/client';
import { eventLogs } from '../../db/schema';
import { publicProcedure, router } from '../trpc-core';

const LOG_LEVELS = ['INFO', 'WARN', 'ERROR'] as const;
const LOG_CATEGORIES = ['AUTH', 'ORDER', 'FSM', 'WS', 'SYS', 'BALANCE', 'CANCEL', 'AI'] as const;
const LOG_DATE_RANGES = ['today', 'month', 'lastMonth', 'last3Months', 'year'] as const;
const LOG_EXPORT_FORMATS = ['csv', 'json'] as const;
const LOG_STREAMS = ['all', 'normal', 'error'] as const;

const TailInputSchema = z
  .object({
    limit: z.number().int().min(1).max(500).default(100),
    beforeId: z.number().int().positive().optional(),
    level: z.enum(LOG_LEVELS).optional(),
    categories: z.array(z.enum(LOG_CATEGORIES)).optional(),
    search: z.string().optional(),
    dateRange: z.enum(LOG_DATE_RANGES).optional(),
    stream: z.enum(LOG_STREAMS).optional(),
  })
  .default({ limit: 100 });

const ExportInputSchema = z.object({
  format: z.enum(LOG_EXPORT_FORMATS),
  level: z.enum(LOG_LEVELS).optional(),
  categories: z.array(z.enum(LOG_CATEGORIES)).optional(),
  search: z.string().optional(),
  dateRange: z.enum(LOG_DATE_RANGES).optional(),
  stream: z.enum(LOG_STREAMS).optional(),
});

export interface LogRow {
  id: number;
  ts: Date;
  level: string;
  category: string;
  message: string;
  payloadJson: string | null;
}

function electronDialog(): typeof import('electron').dialog {
  const req = createRequire(import.meta.url);
  const mod = req('electron') as { dialog: typeof import('electron').dialog };
  return mod.dialog;
}

function resolveLogStartDate(
  dateRange: (typeof LOG_DATE_RANGES)[number] | undefined,
  now: Date = new Date(),
): Date | null {
  if (!dateRange) {
    return null;
  }

  switch (dateRange) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'lastMonth':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    case 'last3Months':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
  }
}

export function readFilteredLogs(
  db: Db,
  input: z.infer<typeof TailInputSchema> | z.infer<typeof ExportInputSchema>,
): LogRow[] {
  const baseQuery = db
    .select({
      id: eventLogs.id,
      ts: eventLogs.ts,
      level: eventLogs.level,
      category: eventLogs.category,
      message: eventLogs.message,
      payloadJson: eventLogs.payloadJson,
    })
    .from(eventLogs);

  const filtered =
    'beforeId' in input && input.beforeId !== undefined
      ? baseQuery.where(lt(eventLogs.id, input.beforeId))
      : baseQuery;

  let rows = filtered.orderBy(desc(eventLogs.id)).all();

  if (input.level) {
    rows = rows.filter((row) => row.level === input.level);
  }

  if (input.stream === 'error') {
    rows = rows.filter((row) => row.level === 'ERROR');
  } else if (input.stream === 'normal') {
    rows = rows.filter((row) => row.level !== 'ERROR');
  }

  if (input.categories && input.categories.length > 0) {
    rows = rows.filter((row) =>
      input.categories?.includes(row.category as (typeof input.categories)[number]),
    );
  }

  if (input.search) {
    const searchLower = input.search.toLowerCase();
    rows = rows.filter((row) => {
      const payload = row.payloadJson ?? '';
      return (
        row.message.toLowerCase().includes(searchLower) ||
        payload.toLowerCase().includes(searchLower)
      );
    });
  }

  const startDate = resolveLogStartDate(input.dateRange);
  if (startDate) {
    rows = rows.filter((row) => {
      const ts = row.ts instanceof Date ? row.ts : new Date(row.ts);
      return ts >= startDate;
    });
  }

  const limited = 'limit' in input ? rows.slice(0, input.limit) : rows;
  return limited.map((row) => ({
    ...row,
    ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
  }));
}

export function buildLogsCsv(rows: readonly LogRow[]): string {
  const columns: CsvColumn<LogRow>[] = [
    { key: 'ts', header: '시각', accessor: (row) => row.ts },
    { key: 'level', header: '레벨', accessor: (row) => row.level },
    { key: 'category', header: '카테고리', accessor: (row) => row.category },
    { key: 'message', header: '메시지', accessor: (row) => row.message },
    { key: 'payload', header: 'payload', accessor: (row) => row.payloadJson ?? '' },
  ];

  return toCsv(rows, columns, { bom: true });
}

function parsePayload(payloadJson: string | null): unknown {
  if (!payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
}

export function buildLogsJson(rows: readonly LogRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      ts: row.ts.toISOString(),
      level: row.level,
      category: row.category,
      message: row.message,
      payload: parsePayload(row.payloadJson),
    })),
    null,
    2,
  );
}

function buildExportFilename(
  format: (typeof LOG_EXPORT_FORMATS)[number],
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().slice(0, 10);
  return `event-logs-${stamp}.${format}`;
}

export const logsRouter = router({
  tail: publicProcedure.input(TailInputSchema).query(({ ctx, input }) => ({
    entries: readFilteredLogs(ctx.db, input),
  })),

  export: publicProcedure.input(ExportInputSchema).mutation(async ({ ctx, input }) => {
    const rows = readFilteredLogs(ctx.db, input);
    const formatLabel = input.format === 'csv' ? 'CSV' : 'JSON';
    const result = await electronDialog().showSaveDialog({
      title: `이벤트 로그 ${formatLabel} 저장`,
      defaultPath: buildExportFilename(input.format),
      filters:
        input.format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true as const };
    }

    const content = input.format === 'csv' ? buildLogsCsv(rows) : buildLogsJson(rows);
    await writeFile(result.filePath, content, 'utf8');

    return {
      canceled: false as const,
      count: rows.length,
      filename: basename(result.filePath),
      format: input.format,
      path: result.filePath,
    };
  }),
});
