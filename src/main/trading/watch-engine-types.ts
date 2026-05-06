import { z } from 'zod';
import type { Timer } from '../brokers/core/types';
import type { Db } from '../db/client';
import type { watchOrders } from '../db/schema';
import type { InFlightCoordinator } from './in-flight-coordinator';

export type WatchSource = 'BOOSTER' | 'PREBUY' | 'CUSTOM';
export type WatchSide = 'BUY' | 'SELL';
export type WatchComparator = 'LTE' | 'GTE';
export type WatchOrderType = 'MARKET' | 'LIMIT';
export type WatchQtyMode = 'QTY' | 'AMOUNT';
export type WatchStatus = 'WATCHING' | 'PAUSED' | 'EXECUTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface WatchOrder {
  id: number;
  accountId: number;
  pdno: string;
  source: WatchSource;
  side: WatchSide;
  targetPrice: number;
  comparator: WatchComparator;
  orderType: WatchOrderType;
  qtyOrAmountMode: WatchQtyMode;
  qty: number | null;
  amountKrw: number | null;
  nth: number | null;
  sourceRefId: string | null;
  expiresAt: Date | null;
  status: WatchStatus;
  lastFailureReason: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
  executedAt: Date | null;
}

export const WatchOrderInputSchema = z
  .object({
    accountId: z.number().int().positive(),
    pdno: z.string().regex(/^\d{6}$/),
    source: z.enum(['BOOSTER', 'PREBUY', 'CUSTOM']),
    side: z.enum(['BUY', 'SELL']),
    targetPrice: z.number().int().positive(),
    comparator: z.enum(['LTE', 'GTE']),
    orderType: z.enum(['MARKET', 'LIMIT']),
    qtyOrAmountMode: z.enum(['QTY', 'AMOUNT']),
    qty: z.number().int().positive().optional(),
    amountKrw: z.number().int().positive().optional(),
    nth: z.number().int().positive().optional(),
    sourceRefId: z.string().min(1).max(120).optional(),
    /** unix epoch ms (Date 또는 number 모두 허용). undefined면 만료 없음. */
    expiresAt: z.union([z.number().int().positive(), z.date()]).optional(),
    metadata: z.string().optional(),
  })
  .refine(
    (v) =>
      v.qtyOrAmountMode === 'QTY'
        ? v.qty !== undefined && v.amountKrw === undefined
        : v.amountKrw !== undefined && v.qty === undefined,
    {
      message: 'mode가 QTY면 qty만, AMOUNT면 amount_krw만 지정하세요 (반대 필드는 비워야 함)',
    },
  );

export type WatchOrderInput = z.infer<typeof WatchOrderInputSchema>;

export type WatchError =
  | { kind: 'VALIDATION'; message: string }
  | { kind: 'NOT_FOUND'; id: number }
  | { kind: 'DB_ERROR'; cause: unknown };

export interface ExecutionResult {
  ok: boolean;
  /** 실패 시 사유 (FAILED 상태에 기록). */
  reason?: string;
  /** true면 상태를 바꾸지 않고 WATCHING 유지. */
  keepWatching?: boolean;
}

export type WatchHandler = (order: WatchOrder, ctx: { price: number }) => Promise<ExecutionResult>;

export interface WatchEngineOptions {
  db: Db;
  timer: Timer;
  /**
   * Phase 3: WatchEngine 인스턴스가 다룰 broker. 기본 'KIS'.
   * 한 인스턴스는 단일 broker 의 watchOrders 만 다룬다 — UPBIT 자동감시는 별도
   * cryptoAutoWatches 테이블 + dispatch layer 로 라우팅.
   */
  broker?: import('@shared/contracts').Broker;
  /** 만료 체크 주기 ms (기본 60s). */
  expiryCheckMs?: number;
  /**
   * source별 글로벌 fallback 핸들러.
   *
   * 라우팅 우선순위:
   *   1. registerHandler(source, accountId, handler) 로 등록된 per-account 핸들러
   *   2. 본 글로벌 fallback (모든 계좌가 동일 핸들러를 공유하는 단일계좌 환경 호환)
   *   3. 둘 다 없으면 FAILED + reason='NO_HANDLER'
   *
   * @deprecated 다계좌 환경에서는 `registerHandler` 사용. 본 필드는 BC 보존용.
   */
  handlers?: Partial<Record<WatchSource, WatchHandler>>;
  /** 트리거/만료 등 라이프사이클 콜백 (옵션). */
  onTriggered?: (order: WatchOrder) => void;
  onExpired?: (order: WatchOrder) => void;
  onExecuted?: (order: WatchOrder) => void;
  onFailed?: (order: WatchOrder, reason: string) => void;
  onWatchingPdnosChanged?: (pdnos: string[]) => void;
  /** StrategyExecutionEngine 등 다른 source 와 cross-dedupe 위한 공유 coordinator (선택). */
  inFlightCoordinator?: InFlightCoordinator;
}

export interface QueueEntry {
  id: number;
  accountId: number;
  pdno: string;
  /** 가격 비교는 인메모리에서. DB는 진실의 원천. */
  comparator: WatchComparator;
  targetPrice: number;
  expiresAt: number | null; // ms epoch
  inFlight: boolean;
}

export const ACTIVE_CONTROL_STATUSES = ['WATCHING', 'PAUSED'] as const;

export function rowToOrder(r: typeof watchOrders.$inferSelect): WatchOrder {
  return {
    id: r.id,
    accountId: r.accountId,
    pdno: r.pdno,
    source: r.source as WatchSource,
    side: r.side as WatchSide,
    targetPrice: r.targetPrice,
    comparator: r.comparator as WatchComparator,
    orderType: r.orderType as WatchOrderType,
    qtyOrAmountMode: r.qtyOrAmountMode as WatchQtyMode,
    qty: r.qty,
    amountKrw: r.amountKrw,
    nth: r.nth,
    sourceRefId: r.sourceRefId,
    expiresAt: r.expiresAt,
    status: r.status as WatchStatus,
    lastFailureReason: r.lastFailureReason,
    metadata: r.metadata,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    executedAt: r.executedAt,
  };
}
