import { desc, lt } from 'drizzle-orm';
import { z } from 'zod';
import { eventLogs } from '../../db/schema';
import { publicProcedure, router } from '../trpc-core';

export const logsRouter = router({
  tail: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(500).default(100),
          beforeId: z.number().int().positive().optional(),
          level: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
          categories: z.array(z.enum(['AUTH', 'ORDER', 'FSM', 'WS', 'SYS', 'BALANCE'])).optional(),
          search: z.string().optional(),
          dateRange: z.enum(['today', 'month', 'lastMonth', 'last3Months', 'year']).optional(),
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
      let rows = filtered.orderBy(desc(eventLogs.id)).limit(input.limit).all();

      // 레벨 필터
      if (input.level) {
        rows = rows.filter((r) => r.level === input.level);
      }

      // 카테고리 필터 (다중 선택)
      if (input.categories && input.categories.length > 0) {
        rows = rows.filter((r) =>
          input.categories?.includes(r.category as (typeof input.categories)[number]),
        );
      }

      // 텍스트 검색 (메시지 부분 매치)
      if (input.search) {
        const searchLower = input.search.toLowerCase();
        rows = rows.filter((r) => r.message.toLowerCase().includes(searchLower));
      }

      // 날짜 범위 필터
      if (input.dateRange) {
        const now = new Date();
        let startDate: Date;

        switch (input.dateRange) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastMonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            break;
          case 'last3Months':
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
            break;
          case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        }

        rows = rows.filter((r) => {
          const ts = r.ts instanceof Date ? r.ts : new Date(r.ts);
          return ts >= startDate;
        });
      }

      return { entries: rows };
    }),
});
