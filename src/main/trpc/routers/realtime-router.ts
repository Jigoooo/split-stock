import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { OrderbookUpdate, TickUpdate } from '../../kis/ws-frame-parser';
import { router, runtimeProcedure } from '../trpc-core';

const PdnoSchema = z.object({
  pdno: z.string().refine((v) => /^\d{6}$/.test(v) || /^KRW-[A-Z0-9]+$/.test(v), 'invalid symbol'),
});
const PdnosSchema = z.object({
  pdnos: z
    .array(
      z.string().refine((v) => /^\d{6}$/.test(v) || /^KRW-[A-Z0-9]+$/.test(v), 'invalid symbol'),
    )
    .max(200),
});
const TopicSchema = z.object({
  pdno: z.string().refine((v) => /^\d{6}$/.test(v) || /^KRW-[A-Z0-9]+$/.test(v), 'invalid symbol'),
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
  start: runtimeProcedure.mutation(async ({ ctx }) => {
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
    ctx.syncAccountRealtimeSubscription();
    return { ok: true as const };
  }),

  stop: runtimeProcedure.mutation(({ ctx }) => {
    ctx.realtime?.stop();
    return { ok: true as const };
  }),

  status: runtimeProcedure.query(({ ctx }) => ({
    started: ctx.realtime?.isStarted() ?? false,
    watched: ctx.realtime?.getWatched() ?? [],
  })),

  watch: runtimeProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    if (!ctx.realtime) return { ok: false as const };
    ctx.realtime.watch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  unwatch: runtimeProcedure.input(TopicSchema).mutation(({ ctx, input }) => {
    ctx.realtime?.unwatch(input.pdno, input.topic);
    return { ok: true as const };
  }),

  getLatestTick: runtimeProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    tick: ctx.bus?.getLatestTick(input.pdno) ?? null,
  })),

  getLatestTicks: runtimeProcedure.input(PdnosSchema).query(({ ctx, input }) => {
    const ticks: Record<string, ReturnType<NonNullable<typeof ctx.bus>['getLatestTick']>> = {};
    for (const pdno of Array.from(new Set(input.pdnos))) {
      ticks[pdno] = ctx.bus?.getLatestTick(pdno) ?? null;
    }
    return { ticks };
  }),

  getLatestOrderbook: runtimeProcedure.input(PdnoSchema).query(({ ctx, input }) => ({
    orderbook: ctx.bus?.getLatestOrderbook(input.pdno) ?? null,
  })),

  onTick: runtimeProcedure.input(PdnoSchema).subscription(({ ctx, input, signal }) => {
    const bus = ctx.bus;
    if (!bus) return emptyStream<TickUpdate>();
    return createPushStream<TickUpdate>(signal, (push) =>
      bus.subscribeTick(input.pdno, (tick) => push(tick)),
    );
  }),

  onTicks: runtimeProcedure.input(PdnosSchema).subscription(({ ctx, input, signal }) => {
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

  onOrderbook: runtimeProcedure.input(PdnoSchema).subscription(({ ctx, input, signal }) => {
    const bus = ctx.bus;
    if (!bus) return emptyStream<OrderbookUpdate>();
    return createPushStream<OrderbookUpdate>(signal, (push) =>
      bus.subscribeOrderbook(input.pdno, (orderbook) => push(orderbook)),
    );
  }),

  /** 사용자가 보고 있는 종목을 priority=100 으로 끌어올려 WS 슬롯 우선 배정. */
  focus: runtimeProcedure.input(PdnoSchema).mutation(({ ctx, input }) => {
    if (!ctx.realtime) return { ok: false as const };
    ctx.realtime.focus(input.pdno);
    return { ok: true as const };
  }),

  blur: runtimeProcedure.input(PdnoSchema).mutation(({ ctx, input }) => {
    ctx.realtime?.blur(input.pdno);
    return { ok: true as const };
  }),

  /**
   * WS 즉시 재연결 — showReconnectButton=true 일 때 사용자가 "재연결" 버튼을 누르면 호출.
   * 자동 복구 30s 이상 실패 후 노출된 버튼만 이 경로로 진입한다 (D3).
   */
  reconnectWs: runtimeProcedure.mutation(({ ctx }) => {
    ctx.realtime?.reconnectWs();
    return { ok: true as const };
  }),

  /**
   * WS/REST 라우팅 결과 — 호가창 등 UI 인디케이터에서 종목별 폴링/실시간 모드 표시용.
   * pdno 미지정 시 활성 계좌 전체 반환.
   */
  getRoutingStatus: runtimeProcedure.input(PdnoSchema.partial()).query(({ ctx, input }) => {
    if (!ctx.realtime) return { subscriptions: [] };
    const all = ctx.realtime.getActiveSubscriptions();
    if (!input.pdno) return { subscriptions: all };
    return { subscriptions: all.filter((s) => s.pdno === input.pdno) };
  }),
});
