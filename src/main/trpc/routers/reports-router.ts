import { TRPCError } from '@trpc/server';
import { and, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { eventLogs } from '../../db/schema';
import {
  computeDailyPnlPointsFromDb,
  computeDailyReport,
  computePnlByLotNthFromDb,
  computeWinRateTimelineFromDb,
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

  /**
   * 일자별 누적 실현손익 포인트 — Reports 차트(라인) 데이터.
   * SOLD 차수만 대상, soldAt 기준 일자 버킷팅 + 누적 합.
   * 거래 없는 날은 포인트 없음 (sparse).
   */
  getDailyPnl: publicProcedure.input(RangeSchema).query(({ ctx, input }) => {
    assertRange(input);
    return { points: computeDailyPnlPointsFromDb(ctx.db, input) };
  }),

  /**
   * 차수(nth)별 손익 분포 — Reports 막대 차트.
   * SOLD 차수만 대상, nth 그룹 후 합산.
   */
  getPnlByLotNth: publicProcedure.input(RangeSchema).query(({ ctx, input }) => {
    assertRange(input);
    return { items: computePnlByLotNthFromDb(ctx.db, input) };
  }),

  /**
   * 일자별 승률 추이 — Reports 라인 차트.
   * 일자 버킷 (winners/total). 거래 없는 날은 포인트 없음.
   */
  getWinRateTimeline: publicProcedure.input(RangeSchema).query(({ ctx, input }) => {
    assertRange(input);
    return { points: computeWinRateTimelineFromDb(ctx.db, input) };
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

  /**
   * 일자별 운영 요약 — event_logs 테이블에서 카테고리·메시지별 집계.
   * - 자동매수 시도/차단, 미체결 자동취소, 보정 적용, 시세 cooldown, 자동감시 실행 카운트.
   * - 사용자가 reports 페이지에서 "오늘의 운영 요약" 카드로 한 눈에 파악.
   */
  getDailyOpsSummary: publicProcedure
    .input(z.object({ date: z.date() }))
    .query(({ ctx, input }) => {
      const dayStart = new Date(input.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const rows = ctx.db
        .select()
        .from(eventLogs)
        .where(and(gte(eventLogs.ts, dayStart), lt(eventLogs.ts, dayEnd)))
        .all();

      const messageCounts = new Map<string, number>();
      const cooldownPdnos = new Set<string>();
      for (const row of rows) {
        messageCounts.set(row.message, (messageCounts.get(row.message) ?? 0) + 1);
        if (row.message === 'quote-feed.cooldown' && row.payloadJson) {
          try {
            const parsed = JSON.parse(row.payloadJson) as { pdno?: string };
            if (parsed.pdno) cooldownPdnos.add(parsed.pdno);
          } catch {
            // ignore — payload 파싱 실패 시 종목명만 세지 못함
          }
        }
      }

      const get = (msg: string): number => messageCounts.get(msg) ?? 0;

      return {
        date: dayStart.toISOString(),
        autoBuy: {
          executed: get('strategy-engine.orders-generated'),
          watchExecuted: get('watch.executed'),
          watchFailed: get('watch.failed'),
          blockedProtection: get('auto-buy.protection.blocked'),
          blockedTimeWindow: get('auto-buy.time-window.blocked'),
          blockedRateGuard: get('auto-buy.rate-guard.sell-only'),
        },
        pendingCancel: {
          success: get('pending-cancel.success'),
          failed: get('pending-cancel.failed'),
          skipped: get('pending-cancel.skip'),
          limitReached: get('pending-cancel.limit-reached'),
        },
        priceCorrection: {
          applied: get('order.price-correction.applied'),
        },
        quoteFeed: {
          cooldownEvents: get('quote-feed.cooldown'),
          cooldownPdnos: Array.from(cooldownPdnos).sort((a, b) => a.localeCompare(b)),
        },
      };
    }),
});
