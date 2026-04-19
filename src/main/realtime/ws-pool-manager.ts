/**
 * WS Pool Manager — KIS WebSocket 한도(세션당 20종목, 향후 60) 안에서
 * 우선순위 desc 순으로 WS 슬롯을 채우고 나머지는 REST 회전 폴링(RotatingQuoteFeed)
 * 으로 위임하는 hybrid 라우팅 매니저.
 *
 * 정책:
 *   - 세션 capacity 안에 들면 WS 구독, 초과분은 REST 폴링
 *   - 우선순위 변경 시 자동 재배치 (debounce 200ms)
 *   - 같은 (accountId, pdno, kind)는 1회만 등록 — 같은 priority 재등록 시 no-op
 *   - 더 높은 priority 재등록 시 priority 갱신 후 재배치
 *   - 계좌별 독립 슬롯 — 계좌 A의 구독은 계좌 B에 영향 없음
 *
 * 우선순위 가이드 (호출측 컨벤션):
 *   100 — 사용자가 보고 있는 종목 (호가창 활성)
 *    80 — 자동매매 활성 보유 종목
 *    60 — 자동감시 (watch-engine)
 *    40 — 일반 보유 종목
 *    20 — 예약매수 감시 종목
 *     1 — 기타
 *
 * KIS 스펙 참고:
 *   - 체결가(H0STCNT0) + 호가(H0STASP0) 합산이 세션당 20개 (향후 60 확장 예정)
 *   - 같은 종목의 PRICE/ORDERBOOK 둘 다 활성화하면 슬롯 2개 소비
 */
import type { Timer } from '../kis/ws-client';
import { realTimer } from '../kis/ws-client';
import type { EventLogger } from '../logging/event-logger';

export type WsKind = 'PRICE' | 'ORDERBOOK' | 'BOTH';

export interface WsPoolSubscribeRequest {
  accountId: number;
  pdno: string;
  kind: WsKind;
  /** 1~100 정수 권장. 같은 (accountId, pdno) 재등록 시 더 높은 값을 채택. */
  priority: number;
}

export interface WsPoolSubscriptionView {
  accountId: number;
  pdno: string;
  kind: WsKind;
  priority: number;
  /** WS 슬롯에 배정되어 실시간 수신 중 → true. capacity 초과로 REST 폴링 위임 → false. */
  isWS: boolean;
  /** REST 폴링 모드면 true. !isWS 와 동치 (가독성용). */
  fallbackToRest: boolean;
}

/**
 * 호출측이 주입하는 WS 어댑터 — 실제 KisWsClient(Pool) subscribe/unsubscribe 를 추상화.
 * test 에서는 fake adapter 주입.
 *
 * kind === 'BOTH' 호출 시 어댑터는 PRICE + ORDERBOOK 두 슬롯을 모두 소비하도록 구현.
 */
export interface WsSubscribeAdapter {
  subscribe(accountId: number, pdno: string, kind: WsKind): void;
  unsubscribe(accountId: number, pdno: string, kind: WsKind): void;
}

/**
 * REST 폴링 어댑터 — 실제 RotatingQuoteFeed.subscribe/unsubscribe 를 추상화.
 * 호가창은 REST 폴링이 시세 라우터 별도 경로(react-query)로 다뤄지므로
 * 본 어댑터는 가격(PRICE/BOTH) 만 fallback 책임.
 */
export interface RestFallbackAdapter {
  subscribe(pdno: string): void;
  unsubscribe(pdno: string): void;
}

export interface WsPoolManagerOptions {
  /** 계좌별 기본 capacity (기본 20). setSessionCapacity 로 동적 변경 가능. */
  defaultCapacity?: number;
  /** 재배치 debounce ms (기본 200). 0 이면 즉시 동기 적용 — 테스트용. */
  rebalanceDebounceMs?: number;
  ws: WsSubscribeAdapter;
  rest: RestFallbackAdapter;
  logger: EventLogger;
  timer?: Timer;
}

interface SubscriptionRecord {
  pdno: string;
  kind: WsKind;
  priority: number;
}

interface AccountSlot {
  capacity: number;
  /** 등록 순서대로 보존 (정렬은 reconcile 에서) — pdno → record */
  records: Map<string, SubscriptionRecord>;
  /** 현재 WS 활성 (accountId, pdno) 집합. */
  wsActive: Set<string>;
  /** 현재 REST fallback 활성 (pdno) 집합. */
  restActive: Set<string>;
  /** kind 집계 — WS 슬롯 산정용 ("PRICE"|"ORDERBOOK"|"BOTH"의 슬롯 비용 = 1|1|2). */
}

const DEFAULT_CAPACITY = 20;

function slotCost(kind: WsKind): number {
  return kind === 'BOTH' ? 2 : 1;
}

/**
 * priority desc 정렬 후 capacity 안에 들어가는 (pdno, kind) 집합을 결정한다.
 * 같은 priority 는 등록 순(insertion order) tiebreak.
 *
 * 반환: WS 활성 pdno 집합 (records 의 부분집합).
 */
function pickWsActive(slot: AccountSlot): Set<string> {
  const sorted: Array<{ pdno: string; rec: SubscriptionRecord }> = [];
  for (const [pdno, rec] of slot.records) sorted.push({ pdno, rec });
  // priority desc, 안정 정렬을 위해 동률은 insertion 순(원래 entries 순서)
  sorted.sort((a, b) => b.rec.priority - a.rec.priority);

  const result = new Set<string>();
  let used = 0;
  for (const { pdno, rec } of sorted) {
    const cost = slotCost(rec.kind);
    if (used + cost > slot.capacity) continue;
    result.add(pdno);
    used += cost;
  }
  return result;
}

/**
 * WS 풀 매니저 — 계좌별 capacity 안에서 우선순위 기반 WS/REST 라우팅을 담당.
 *
 * 호출 흐름:
 *   1. trading-panel/dashboard 등 renderer 가 watch 시작 → tRPC → manager.subscribe
 *   2. manager 는 즉시 records 갱신 + scheduleRebalance (debounce)
 *   3. debounce 만료 시 reconcile() → 계좌별로 WS active 집합 재계산 → adapter 호출 diff
 *
 * 동시성:
 *   - reconcile 은 동기 — adapter.subscribe/unsubscribe 가 비동기여도 manager 는 fire-and-forget
 *   - debounce 0 인 테스트 모드에서는 subscribe 호출이 곧바로 reconcile 트리거
 */
export class WsPoolManager {
  private readonly ws: WsSubscribeAdapter;
  private readonly rest: RestFallbackAdapter;
  private readonly logger: EventLogger;
  private readonly timer: Timer;
  private readonly defaultCapacity: number;
  private readonly debounceMs: number;
  private readonly slots = new Map<number, AccountSlot>();
  private rebalanceHandle: { clear: () => void } | null = null;

  constructor(opts: WsPoolManagerOptions) {
    this.ws = opts.ws;
    this.rest = opts.rest;
    this.logger = opts.logger;
    this.timer = opts.timer ?? realTimer;
    this.defaultCapacity = opts.defaultCapacity ?? DEFAULT_CAPACITY;
    this.debounceMs = opts.rebalanceDebounceMs ?? 200;
  }

  subscribe(req: WsPoolSubscribeRequest): void {
    const slot = this.ensureSlot(req.accountId);
    const existing = slot.records.get(req.pdno);
    if (existing) {
      // 같은 (kind, priority) 면 변동 없음
      if (existing.kind === req.kind && existing.priority === req.priority) return;
      // 더 높은 priority 또는 kind 변경이면 갱신. 더 낮은 priority 는 무시 (호출측 잡음 방지).
      const nextPriority = Math.max(existing.priority, req.priority);
      slot.records.set(req.pdno, {
        pdno: req.pdno,
        kind: req.kind,
        priority: nextPriority,
      });
    } else {
      slot.records.set(req.pdno, {
        pdno: req.pdno,
        kind: req.kind,
        priority: req.priority,
      });
    }
    this.scheduleRebalance();
  }

  unsubscribe(accountId: number, pdno: string, kind?: WsKind): void {
    const slot = this.slots.get(accountId);
    if (!slot) return;
    const existing = slot.records.get(pdno);
    if (!existing) return;

    if (!kind || kind === 'BOTH' || kind === existing.kind) {
      slot.records.delete(pdno);
    } else if (existing.kind === 'BOTH') {
      // BOTH 등록 상태에서 PRICE 또는 ORDERBOOK 만 해지 — 남은 다른 한쪽 유지
      const remaining: WsKind = kind === 'PRICE' ? 'ORDERBOOK' : 'PRICE';
      slot.records.set(pdno, { ...existing, kind: remaining });
    } else {
      // existing.kind 와 다른 단일 kind 해지 요청 → 현 등록은 영향 없음
      return;
    }
    this.scheduleRebalance();
  }

  /** 계좌별 capacity 동적 변경 — KIS 가 60종목으로 확장될 때 사용. */
  setSessionCapacity(accountId: number, capacity: number): void {
    if (capacity < 0 || !Number.isFinite(capacity)) return;
    const slot = this.ensureSlot(accountId);
    if (slot.capacity === capacity) return;
    slot.capacity = capacity;
    this.scheduleRebalance();
    this.logger.log({
      level: 'INFO',
      category: 'WS',
      message: 'ws-pool.capacity_changed',
      payload: { accountId, capacity },
    });
  }

  /** 계좌별 현재 구독 상태 조회 — UI/디버깅용. */
  getActiveSubscriptions(accountId: number): WsPoolSubscriptionView[] {
    const slot = this.slots.get(accountId);
    if (!slot) return [];
    const out: WsPoolSubscriptionView[] = [];
    for (const [pdno, rec] of slot.records) {
      const isWS = slot.wsActive.has(pdno);
      out.push({
        accountId,
        pdno,
        kind: rec.kind,
        priority: rec.priority,
        isWS,
        fallbackToRest: !isWS,
      });
    }
    out.sort((a, b) => b.priority - a.priority);
    return out;
  }

  /** 즉시 재배치 — 테스트/긴급용. debounce 무시. */
  reconcileNow(): void {
    if (this.rebalanceHandle) {
      this.rebalanceHandle.clear();
      this.rebalanceHandle = null;
    }
    this.reconcileAll();
  }

  /** 모든 슬롯 정리 — env 전환/teardown 시 호출. */
  dispose(): void {
    if (this.rebalanceHandle) {
      this.rebalanceHandle.clear();
      this.rebalanceHandle = null;
    }
    for (const [accountId, slot] of this.slots) {
      for (const pdno of slot.wsActive) {
        const rec = slot.records.get(pdno);
        if (rec) this.ws.unsubscribe(accountId, pdno, rec.kind);
      }
      for (const pdno of slot.restActive) this.rest.unsubscribe(pdno);
    }
    this.slots.clear();
  }

  private ensureSlot(accountId: number): AccountSlot {
    let slot = this.slots.get(accountId);
    if (!slot) {
      slot = {
        capacity: this.defaultCapacity,
        records: new Map(),
        wsActive: new Set(),
        restActive: new Set(),
      };
      this.slots.set(accountId, slot);
    }
    return slot;
  }

  private scheduleRebalance(): void {
    if (this.debounceMs <= 0) {
      this.reconcileAll();
      return;
    }
    if (this.rebalanceHandle) this.rebalanceHandle.clear();
    this.rebalanceHandle = this.timer.setTimeout(() => {
      this.rebalanceHandle = null;
      this.reconcileAll();
    }, this.debounceMs);
  }

  private reconcileAll(): void {
    for (const [accountId, slot] of this.slots) {
      this.reconcileSlot(accountId, slot);
    }
  }

  private reconcileSlot(accountId: number, slot: AccountSlot): void {
    const desiredWs = pickWsActive(slot);
    const desiredRest = new Set<string>();
    for (const [pdno, rec] of slot.records) {
      // PRICE 또는 BOTH 는 가격이 필요하므로 WS 미배정 시 REST fallback.
      // ORDERBOOK 단독은 WS 미배정 시 REST 폴링 대상이 아님 (orderbook REST 는 별도 경로).
      if (desiredWs.has(pdno)) continue;
      if (rec.kind === 'PRICE' || rec.kind === 'BOTH') desiredRest.add(pdno);
    }

    // 1) WS unsubscribe diff (current - desired)
    for (const pdno of slot.wsActive) {
      if (!desiredWs.has(pdno)) {
        const rec = slot.records.get(pdno);
        // record 가 사라졌어도 unsubscribe 는 마지막 알려진 kind 가 가장 안전.
        // 단, BOTH→PRICE 처럼 kind 가 좁혀진 경우는 이전 BOTH 로 모두 해지하고 다음 단계에서 재구독.
        // record 가 있으면 desired 와 비교해 kind 변경분만 처리.
        const targetRecKind = rec?.kind;
        if (targetRecKind !== undefined) {
          this.ws.unsubscribe(accountId, pdno, targetRecKind);
        } else {
          this.ws.unsubscribe(accountId, pdno, 'BOTH');
        }
      }
    }

    // 2) WS subscribe diff (desired - current). kind 변경(BOTH↔PRICE 등)도 다시 정렬.
    for (const pdno of desiredWs) {
      const rec = slot.records.get(pdno);
      if (!rec) continue;
      const wasActive = slot.wsActive.has(pdno);
      // wasActive 라도 kind 가 바뀌었으면 unsubscribe 후 다시 subscribe — 어댑터가 idempotent 보장 가정.
      if (!wasActive) {
        this.ws.subscribe(accountId, pdno, rec.kind);
      }
    }

    // 3) REST unsubscribe diff
    for (const pdno of slot.restActive) {
      if (!desiredRest.has(pdno)) this.rest.unsubscribe(pdno);
    }

    // 4) REST subscribe diff
    for (const pdno of desiredRest) {
      if (!slot.restActive.has(pdno)) this.rest.subscribe(pdno);
    }

    // 상태 commit
    slot.wsActive = desiredWs;
    slot.restActive = desiredRest;
  }
}
