import { desc, lt } from 'drizzle-orm';
import { z } from 'zod';
import { eventLogs } from '../../db/schema';
import { publicProcedure, router } from '../trpc-core';

const LevelSchema = z.enum(['INFO', 'WARN', 'ERROR']);
const CategorySchema = z.enum(['AUTH', 'ORDER', 'FSM', 'WS', 'SYS']);

export const logsRouter = router({
  tail: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(500).default(100),
          beforeId: z.number().int().positive().optional(),
          level: LevelSchema.optional(),
          category: CategorySchema.optional(),
        })
        .default({ limit: 100 }),
    )
    .query(({ ctx, input }) => {
      const baseQuery = ctx.db
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
        input.beforeId !== undefined
          ? baseQuery.where(lt(eventLogs.id, input.beforeId))
          : baseQuery;
      const rows = filtered.orderBy(desc(eventLogs.id)).limit(input.limit).all();
      const filteredByLevel = input.level ? rows.filter((r) => r.level === input.level) : rows;
      const filteredByCategory = input.category
        ? filteredByLevel.filter((r) => r.category === input.category)
        : filteredByLevel;
      return { entries: filteredByCategory };
    }),
});
