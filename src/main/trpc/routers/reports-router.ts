import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  computeDailyReport,
  exportEventsCsv,
  exportLotsCsv,
  exportTradesCsv,
} from '../../reporting/daily-report';
import { publicProcedure, router } from '../trpc-core';

const RangeSchema = z.object({
  from: z.date(),
  to: z.date(),
});

function assertRange(input: { from: Date; to: Date }): void {
  if (input.from.getTime() > input.to.getTime()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '시작일이 종료일보다 뒤일 수 없습니다',
    });
  }
}

const EventsFilterSchema = RangeSchema.extend({
  level: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
  category: z.enum(['AUTH', 'ORDER', 'FSM', 'WS', 'SYS']).optional(),
});

const CsvKindSchema = z.enum(['trades', 'lots', 'events']);

export const reportsRouter = router({
  getSummary: publicProcedure.input(RangeSchema).query(({ ctx, input }) => {
    assertRange(input);
    return computeDailyReport(ctx.db, input);
  }),

  exportCsv: publicProcedure
    .input(
      z.union([
        RangeSchema.extend({ kind: z.literal('trades') }),
        RangeSchema.extend({ kind: z.literal('lots') }),
        EventsFilterSchema.extend({ kind: z.literal('events') }),
      ]),
    )
    .query(({ ctx, input }) => {
      assertRange(input);
      const kind: 'trades' | 'lots' | 'events' = input.kind;
      if (kind === 'trades') {
        return { csv: exportTradesCsv(ctx.db, { from: input.from, to: input.to }) };
      }
      if (kind === 'lots') {
        return { csv: exportLotsCsv(ctx.db, { from: input.from, to: input.to }) };
      }
      return {
        csv: exportEventsCsv(ctx.db, {
          from: input.from,
          to: input.to,
          ...('level' in input && input.level !== undefined ? { level: input.level } : {}),
          ...('category' in input && input.category !== undefined
            ? { category: input.category }
            : {}),
        }),
      };
    }),

  csvKinds: publicProcedure.query(() => ({ kinds: CsvKindSchema.options })),
});
