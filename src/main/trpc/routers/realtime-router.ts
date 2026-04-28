import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { OrderbookUpdate, TickUpdate } from '../../kis/ws-frame-parser';
import { authedProcedure, router } from '../trpc-core';

const PdnoSchema = z.object({ pdno: z.string().regex(/^\d{6}$/) });
const PdnosSchema = z.object({
  pdnos: z.array(z.string().regex(/^\d{6}$/)).max(200),
});
const TopicSchema = z.object({
  pdno: z.string().regex(/^\d{6}$/),
  topic: z.enum(['tick', 'orderbook']),
});

function createPushStream<T>(
  signal: AbortSignal | undefined,
  subscribe: (push: (value: T) => void) => () => void,
): AsyncIterable<T> {
  return (async function* stream() {
    if (signal?.aborted) return;

    const queue: T[] = [];
    let wake: (() => void) | null = null;
    let stopped = false;
    const wakeNext = (): void => {
      wake?.();
      wake = null;
    };
    const unsubscribe = subscribe((value) => {
      queue.push(value);
      wakeNext();
    });
    const onAbort = (): void => {
      stopped = true;
      wakeNext();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (!stopped) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield queue.shift() as T;
      }
    } finally {
      stopped = true;
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      wakeNext();
    }
  })();
}

async function* emptyStream<T>(): AsyncIterable<T> {}

export const realtimeRouter = router({
  start: authedProcedure.mutation(async ({ ctx }) => {
    const env = ctx.currentEnv;
    if (!env) throw new TRPCError({ code: 'UNAUTHORIZED', message: '환경 미선택' });
    if (!ctx.realtime) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '실시간 서비스가 초기화되지 않음',
      });
    }
    const credResult = ctx.credentialsRepo.loadCredentialsByEnv(env);
    if (credResult.isErr() || !credResult.value) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '자격증명 없음' });
    }
    const cred = credResult.value;
    const r = await ctx.realtime.start(cred.appKey, cred.appSecret);
    if (!r.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `실시간 시작 실패: ${r.reason ?? ''}`,
      });
    }
    return { ok: true as const };
  }),

  stop: authedProcedure.mutation(({ ctx }) => {
    ctx.realtime?.stop();
    return { ok: true as const };
  }),

  status: authedProcedure.query(({ ctx }) => ({
    started: ctx.realtime?.isStarted() ?? false,
    watched: ctx.realtime?.getWatched() ?? [],
  })),

  watch: authedProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    if (!ctx.realtime) return { ok: false as const };
    ctx.realtime.watch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  unwatch: authedProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    ctx.realtime?.unwatch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  getLatestTick: authedProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    tick: ctx.bus?.getLatestTick(input.pdno) ?? null,
  })),

  getLatestTicks: authedProcedure.input(PdnosSchema).query(({ ctx, input }) => {
    const ticks: Record<string, ReturnType<NonNullable<typeof ctx.bus>['getLatestTick']>> = {};
    for (const pdno of Array.from(new Set(input.pdnos))) {
      ticks[pdno] = ctx.bus?.getLatestTick(pdno) ?? null;
    }
    return { ticks };
  }),

  getLatestOrderbook: authedProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    orderbook: ctx.bus?.getLatestOrderbook(input.pdno) ?? null,
  })),

  onTick: authedProcedure.input(PdnoSchema).subscription(({ ctx, input, signal }) => {
    const bus = ctx.bus;
    if (!bus) return emptyStream<TickUpdate>();
    return createPushStream<TickUpdate>(signal, (push) =>
      bus.subscribeTick(input.pdno, (tick) => push(tick)),
    );
  }),

  onTicks: authedProcedure.input(PdnosSchema).subscription(({ ctx, input, signal }) => {
    const bus = ctx.bus;
    if (!bus) return emptyStream<Record<string, TickUpdate | null>>();

    return createPushStream<Record<string, TickUpdate | null>>(signal, (push) => {
      const pdnos = Array.from(new Set(input.pdnos));
      const latest = new Map<string, TickUpdate | null>(
        pdnos.map((pdno) => [pdno, bus.getLatestTick(pdno)]),
      );
      const pushLatest = (): void => {
        const ticks: Record<string, TickUpdate | null> = {};
        for (const pdno of pdnos) {
          ticks[pdno] = latest.get(pdno) ?? null;
        }
        push(ticks);
      };

      let ready = false;
      const unsubscribers = pdnos.map((pdno) =>
        bus.subscribeTick(pdno, (tick) => {
          latest.set(pdno, tick);
          if (ready) pushLatest();
        }),
      );
      ready = true;
      pushLatest();

      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    });
  }),

  onOrderbook: authedProcedure.input(PdnoSchema).subscription(({ ctx, input, signal }) => {
    const bus = ctx.bus;
    if (!bus) return emptyStream<OrderbookUpdate>();
    return createPushStream<OrderbookUpdate>(signal, (push) =>
      bus.subscribeOrderbook(input.pdno, (orderbook) => push(orderbook)),
    );
  }),

  /** 사용자가 보고 있는 종목을 priority=100 으로 끌어올려 WS 슬롯 우선 배정. */
  focus: authedProcedure.input(PdnoSchema).mutation(({ ctx, input }) => {
    if (!ctx.realtime) return { ok: false as const };
    ctx.realtime.focus(input.pdno);
    return { ok: true as const };
  }),

  blur: authedProcedure.input(PdnoSchema).mutation(({ ctx, input }) => {
    ctx.realtime?.blur(input.pdno);
    return { ok: true as const };
  }),

  /**
   * WS/REST 라우팅 결과 — 호가창 등 UI 인디케이터에서 종목별 폴링/실시간 모드 표시용.
   * pdno 미지정 시 활성 계좌 전체 반환.
   */
  getRoutingStatus: authedProcedure.input(PdnoSchema.partial()).query(({ ctx, input }) => {
    if (!ctx.realtime) return { subscriptions: [] };
    const all = ctx.realtime.getActiveSubscriptions();
    if (!input.pdno) return { subscriptions: all };
    return { subscriptions: all.filter((s) => s.pdno === input.pdno) };
  }),
});
