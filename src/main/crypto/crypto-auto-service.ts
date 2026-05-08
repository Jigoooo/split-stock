import {
  type CryptoAutoConfig,
  type CryptoAutoGateResult,
  CryptoAutoGuardConfigSchema,
  type CryptoAutoIntent,
  type CryptoAutoLotSource,
  type CryptoAutoRunResult,
  type CryptoAutoWatchEntryCondition,
  type CryptoBalance,
  type CryptoExchangeError,
  CryptoKrwMarketCodeSchema,
  type CryptoOrderIntent,
  type CryptoOrderSnapshot,
  type CryptoReadonlySmokeResult,
  type CryptoStrategyProfile,
  CryptoStrategyProfileSchema,
} from '@shared/contracts';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
import type { CryptoAutoBuyGuardPort } from '../safety/crypto-auto-buy-guard';
import type { CryptoAutoTradingRepo } from './crypto-auto-repo';
import {
  assertDecimalString,
  decimalAddStrict,
  decimalDivStrict,
  decimalGteStrict,
  decimalGtStrict,
  decimalLteStrict,
  decimalMulStrict,
  decimalSubStrict,
  normalizeUpbitKrwLimitPrice,
  UPBIT_KRW_MIN_ORDER_TOTAL,
} from './upbit/decimal';

export interface CryptoAutoLiveAdapter {
  createOrder(intent: CryptoOrderIntent): Promise<Result<unknown, CryptoExchangeError>>;
  cancelOrder(input: {
    uuid?: string;
    identifier?: string;
  }): Promise<Result<unknown, CryptoExchangeError>>;
}

export interface CryptoAutoServiceOptions {
  repo: CryptoAutoTradingRepo;
  logger: EventLogger;
  now?: () => number;
  /** 글로벌 자동매매 잠금 — broker-agnostic SafetyStateRegistry. (RALPLAN P6 A1) */
  safetyRegistry?: {
    get(accountId: number): {
      canTrade(symbol: string): boolean;
      getSnapshot(): { master: boolean; errorLock: { active: boolean; reason?: string | null } };
    };
  };
  /**
   * 연속매수 방지 — broker-agnostic RateGuard. (RALPLAN P6 A2)
   * 매수 성공 직후 recordBuy + checkAndPossiblyDisableAuto 호출.
   * 윈도우 내 임계 초과 시 SafetyStateRegistry.master=false 자동 전환.
   */
  rateGuard?: {
    recordBuy(accountId: number, symbol: string, ts: number): void;
    checkAndPossiblyDisableAuto(accountId: number): { switchedToManual: boolean };
  };
  /**
   * 일/계좌 한도 + RateGuard per-symbol SELL_ONLY 전환. (E2-2)
   *
   * post-E2 hardening: 보호 한도 검사는 cryptoAutoBuyGuard 단일 호출로 통일.
   * 이전에는 gate 측 protectionGuard.canBuyToday 와 cryptoAutoBuyGuard 내부의
   * 동일 검사가 중복 호출되어 blocked event 가 두 군데 기록되던 문제가 있었다.
   */
  cryptoAutoBuyGuard?: CryptoAutoBuyGuardPort;
}

export interface CryptoAutoTickInput {
  accountId: number;
  market: string;
  balances: CryptoBalance[];
  tradePrice: string;
  lotSource?: CryptoAutoLotSource;
}

export interface CryptoAutoLiveTickInput extends CryptoAutoTickInput {
  adapter: CryptoAutoLiveAdapter;
}

function cryptoExchangeError(message: string, raw?: unknown): CryptoExchangeError {
  return {
    exchangeId: 'UPBIT',
    kind: 'VALIDATION',
    message,
    raw,
  };
}

function safeKrwMarket(
  market: string,
): Result<ReturnType<typeof CryptoKrwMarketCodeSchema.parse>, CryptoExchangeError> {
  const parsed = CryptoKrwMarketCodeSchema.safeParse(market);
  if (!parsed.success) {
    return err(
      cryptoExchangeError('자동매매는 Upbit KRW 마켓만 지원합니다.', {
        issueCount: parsed.error.issues.length,
      }),
    );
  }
  return ok(parsed.data);
}

function ensureConfig(config: CryptoAutoConfig): Result<CryptoAutoConfig, CryptoExchangeError> {
  const parsed = CryptoAutoGuardConfigSchema.safeParse(config);
  if (!parsed.success) {
    return err(
      cryptoExchangeError('코인 자동매매 설정이 올바르지 않습니다.', {
        issueCount: parsed.error.issues.length,
      }),
    );
  }
  try {
    assertDecimalString(config.baseOrderKrw, { field: 'baseOrderKrw' });
    assertDecimalString(config.maxOrderKrw, { field: 'maxOrderKrw' });
    assertDecimalString(config.maxTotalExposureKrw, { field: 'maxTotalExposureKrw' });
    assertDecimalString(config.minOrderTotalKrw, { field: 'minOrderTotalKrw' });
    assertDecimalString(config.addTriggerPct, { field: 'addTriggerPct' });
    assertDecimalString(config.takeProfitPct, { field: 'takeProfitPct' });
  } catch (cause) {
    return err(cryptoExchangeError(cause instanceof Error ? cause.message : String(cause), cause));
  }
  if (!decimalGteStrict(config.minOrderTotalKrw, UPBIT_KRW_MIN_ORDER_TOTAL)) {
    return err(
      cryptoExchangeError(`최소 주문금액은 ${UPBIT_KRW_MIN_ORDER_TOTAL} KRW 이상이어야 합니다.`),
    );
  }
  return ok(config);
}

function ensureStrategy(
  strategy: CryptoStrategyProfile,
): Result<CryptoStrategyProfile, CryptoExchangeError> {
  const parsed = CryptoStrategyProfileSchema.safeParse(strategy);
  if (!parsed.success) {
    return err(
      cryptoExchangeError('코인 자동매매 차수 전략이 올바르지 않습니다.', {
        issueCount: parsed.error.issues.length,
      }),
    );
  }
  try {
    for (const rule of parsed.data.buyRules) {
      assertDecimalString(rule.amountKrw, { field: `buyRules.${rule.nth}.amountKrw` });
      if (rule.triggerDropPct !== null) {
        assertDecimalString(rule.triggerDropPct, {
          field: `buyRules.${rule.nth}.triggerDropPct`,
        });
      }
    }
    for (const rule of parsed.data.sellRules) {
      assertDecimalString(rule.targetProfitPct, {
        field: `sellRules.${rule.nth}.targetProfitPct`,
      });
    }
  } catch (cause) {
    return err(cryptoExchangeError(cause instanceof Error ? cause.message : String(cause), cause));
  }
  return ok(parsed.data);
}

function availableKrw(balances: CryptoBalance[]): string {
  return balances.find((balance) => balance.currency === 'KRW')?.balance ?? '0';
}

function openExposureKrw(lots: Array<{ allocatedKrw: string }>): string {
  return lots.reduce((sum, lot) => decimalAddStrict(sum, lot.allocatedKrw), '0');
}

function buildIdentifier(input: {
  accountId: number;
  market: string;
  intent: CryptoAutoIntent;
  now: number;
}): string {
  return `crypto-auto:${input.accountId}:${input.market}:${input.intent.kind}:${input.now}`;
}

function buyRuleForNextStage(
  strategy: CryptoStrategyProfile,
  openLotCount: number,
): CryptoStrategyProfile['buyRules'][number] | null {
  return strategy.buyRules.find((rule) => rule.nth === openLotCount + 1) ?? null;
}

function sellRuleForLot(
  strategy: CryptoStrategyProfile,
  sequence: number,
): CryptoStrategyProfile['sellRules'][number] | null {
  return strategy.sellRules.find((rule) => rule.nth === sequence) ?? null;
}

function entryConditionMet(condition: CryptoAutoWatchEntryCondition, tradePrice: string): boolean {
  if (condition.type === 'immediate') return true;
  if (!condition.price) return false;
  if (condition.type === 'price-above') return decimalGteStrict(tradePrice, condition.price);
  return decimalLteStrict(tradePrice, condition.price);
}

export class CryptoAutoTradingService {
  private readonly repo: CryptoAutoTradingRepo;
  private readonly logger: EventLogger;
  private readonly now: () => number;
  private readonly safetyRegistry: CryptoAutoServiceOptions['safetyRegistry'];
  private readonly rateGuard: CryptoAutoServiceOptions['rateGuard'];
  private readonly cryptoAutoBuyGuard: CryptoAutoServiceOptions['cryptoAutoBuyGuard'];

  constructor(options: CryptoAutoServiceOptions) {
    this.repo = options.repo;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.safetyRegistry = options.safetyRegistry;
    this.rateGuard = options.rateGuard;
    this.cryptoAutoBuyGuard = options.cryptoAutoBuyGuard;
  }

  getGate(input: {
    accountId: number;
    market: string;
    intent?: CryptoAutoIntent;
    requireIdempotency?: boolean;
    idempotencyKey?: string | null;
  }): Result<CryptoAutoGateResult, CryptoExchangeError> {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return err(market.error);
    const config = this.repo.getConfig(input.accountId, market.value);
    const checked = ensureConfig(config);
    if (checked.isErr()) return err(checked.error);
    const blockedReasons: string[] = [];

    if (this.safetyRegistry) {
      const snap = this.safetyRegistry.get(input.accountId).getSnapshot();
      if (!snap.master) blockedReasons.push('글로벌 자동매매가 OFF 상태입니다.');
      if (snap.errorLock.active) {
        blockedReasons.push(snap.errorLock.reason ?? '에러 잠금 상태입니다.');
      }
    }

    if (config.mode !== 'live-small') blockedReasons.push('live-small 모드가 아닙니다.');
    if (config.emergencyDisabled) blockedReasons.push('비상 중지 상태입니다.');
    if (config.requireReadOnlySmoke && config.lastReadonlySmokeAt === null) {
      blockedReasons.push('성공한 read-only smoke 기록이 없습니다.');
    }
    if (
      config.requireDryRunHistoryBeforeLive &&
      !this.repo.hasDryRunHistory(input.accountId, market.value)
    ) {
      blockedReasons.push('live 전 dry-run 이력이 없습니다.');
    }
    if (
      config.lastLiveActionAt !== null &&
      this.now() - config.lastLiveActionAt < config.cooldownMs
    ) {
      blockedReasons.push('cooldown 중입니다.');
    }
    if (input.requireIdempotency && !input.idempotencyKey) {
      blockedReasons.push('idempotency identifier가 없습니다.');
    }

    const recentCancels = this.repo.countEventsSince({
      accountId: input.accountId,
      market: market.value,
      kind: 'live-cancel',
      sinceMs: this.now() - 86_400_000,
    });
    if (input.intent?.kind === 'cancel-stale' && recentCancels >= config.staleCancelCap) {
      blockedReasons.push('stale cancel cap을 초과했습니다.');
    }

    if (input.intent?.kind === 'plan-buy') {
      if (decimalGtStrict(input.intent.krwAmount, config.maxOrderKrw)) {
        blockedReasons.push('주문 금액이 주문당 KRW 상한을 초과했습니다.');
      }
      if (!decimalGteStrict(input.intent.krwAmount, config.minOrderTotalKrw)) {
        blockedReasons.push('주문 금액이 최소 주문금액 미만입니다.');
      }
      const nextExposure = decimalAddStrict(
        openExposureKrw(this.repo.listOpenLots(input.accountId, market.value, 'live')),
        input.intent.krwAmount,
      );
      if (decimalGtStrict(nextExposure, config.maxTotalExposureKrw)) {
        blockedReasons.push('총 노출 KRW 상한을 초과했습니다.');
      }
      // NOTE: protectionGuard.canBuyToday 검사는 cryptoAutoBuyGuard.assertAutoBuyAllowed
      // 가 runLiveTick 직전에 단일 호출하도록 통일했다 (post-E2 hardening). gate 측에서
      // 호출하면 blocked event 가 두 군데(insertEvent kind='blocked' x2) 기록되어
      // 중복 추적 비용이 발생. UI 측 getGate (intent 미전달) 는 이 분기에 진입조차 하지
      // 않으므로 표시 회귀 없음.
    }

    if (input.intent?.kind === 'plan-sell') {
      const total = decimalMulStrict(input.intent.quantity, input.intent.limitPrice);
      if (!decimalGteStrict(total, config.minOrderTotalKrw)) {
        blockedReasons.push('매도 평가금액이 최소 주문금액 미만입니다.');
      }
    }

    return ok({ ok: blockedReasons.length === 0, blockedReasons });
  }

  plan(input: CryptoAutoTickInput): Result<CryptoAutoIntent, CryptoExchangeError> {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return err(market.error);
    const config = this.repo.getConfig(input.accountId, market.value);
    const checked = ensureConfig(config);
    if (checked.isErr()) return err(checked.error);
    const checkedStrategy = ensureStrategy(this.repo.getStrategy(input.accountId, market.value));
    if (checkedStrategy.isErr()) return err(checkedStrategy.error);
    const strategy = checkedStrategy.value;
    try {
      assertDecimalString(input.tradePrice, { field: 'tradePrice' });
      for (const balance of input.balances) {
        assertDecimalString(balance.balance, {
          allowZero: true,
          field: `${balance.currency}.balance`,
        });
        assertDecimalString(balance.locked, {
          allowZero: true,
          field: `${balance.currency}.locked`,
        });
      }
    } catch (cause) {
      return err(
        cryptoExchangeError(cause instanceof Error ? cause.message : String(cause), cause),
      );
    }

    if (config.mode === 'disabled') {
      return ok({
        kind: 'noop',
        market: market.value,
        reason: '자동매매가 비활성화되어 있습니다.',
      });
    }

    const priceFloor = normalizeUpbitKrwLimitPrice(input.tradePrice, 'floor');
    const priceCeil = normalizeUpbitKrwLimitPrice(input.tradePrice, 'ceil');
    const lotSource = input.lotSource ?? (config.mode === 'live-small' ? 'live' : 'dry-run');
    const lots = this.repo.listOpenLots(input.accountId, market.value, lotSource);
    const activeWatch =
      this.repo.listWatches(input.accountId, {
        includeCancelled: false,
        market: market.value,
        status: 'WATCHING',
      })[0] ?? null;
    const sellLot = lots.find((lot) => {
      const sellRule = sellRuleForLot(strategy, lot.sequence);
      if (!sellRule) return false;
      const target = decimalMulStrict(
        lot.avgEntryKrw,
        decimalAddStrict('1', sellRule.targetProfitPct),
      );
      return decimalGteStrict(input.tradePrice, target);
    });
    if (sellLot) {
      if (!strategy.autoSellEnabled) {
        return ok({ kind: 'noop', market: market.value, reason: '자동매도가 OFF 상태입니다.' });
      }
      return ok({
        kind: 'plan-sell',
        market: market.value,
        lotId: sellLot.id,
        quantity: sellLot.quantity,
        limitPrice: priceCeil,
      });
    }

    if (!strategy.autoBuyEnabled) {
      return ok({ kind: 'noop', market: market.value, reason: '자동매수가 OFF 상태입니다.' });
    }
    const nextBuyRule = buyRuleForNextStage(strategy, lots.length);
    if (!nextBuyRule) {
      return ok({ kind: 'noop', market: market.value, reason: '다음 차수 매수 규칙이 없습니다.' });
    }
    const quoteAmount = decimalLteStrict(nextBuyRule.amountKrw, config.maxOrderKrw)
      ? nextBuyRule.amountKrw
      : config.maxOrderKrw;
    const quoteAvailable = availableKrw(input.balances);
    if (!decimalGteStrict(quoteAvailable, quoteAmount)) {
      return ok({ kind: 'noop', market: market.value, reason: 'KRW 주문 가능 잔고가 부족합니다.' });
    }
    if (!decimalGteStrict(quoteAmount, config.minOrderTotalKrw)) {
      return ok({
        kind: 'noop',
        market: market.value,
        reason: '차수 주문금액이 최소 주문금액 미만입니다.',
      });
    }
    if (lots.length === 0) {
      if (!activeWatch) {
        return ok({
          kind: 'noop',
          market: market.value,
          reason: '활성 자동감시 항목이 없습니다.',
        });
      }
      if (!entryConditionMet(activeWatch.entryCondition, input.tradePrice)) {
        return ok({
          kind: 'noop',
          market: market.value,
          reason: '최초 매수 감시 조건이 충족되지 않았습니다.',
        });
      }
      return ok({
        kind: 'plan-buy',
        market: market.value,
        krwAmount: quoteAmount,
        limitPrice: priceFloor,
      });
    }
    if (lots.length >= strategy.maxStages) {
      return ok({ kind: 'noop', market: market.value, reason: '최대 open lot 수에 도달했습니다.' });
    }
    const previousLot = [...lots].sort((left, right) => right.sequence - left.sequence)[0];
    if (previousLot && nextBuyRule.triggerDropPct !== null) {
      const addTrigger = decimalMulStrict(
        previousLot.avgEntryKrw,
        decimalSubStrict('1', nextBuyRule.triggerDropPct),
      );
      if (decimalLteStrict(input.tradePrice, addTrigger)) {
        return ok({
          kind: 'plan-buy',
          market: market.value,
          krwAmount: quoteAmount,
          limitPrice: priceFloor,
        });
      }
    }
    return ok({
      kind: 'noop',
      market: market.value,
      reason: '분할매매 조건이 충족되지 않았습니다.',
    });
  }

  runDryTick(input: CryptoAutoTickInput): Result<CryptoAutoRunResult, CryptoExchangeError> {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return err(market.error);
    const planned = this.plan({ ...input, lotSource: 'dry-run' });
    if (planned.isErr()) {
      const config = this.repo.getConfig(input.accountId, market.value);
      this.repo.insertEvent({
        accountId: input.accountId,
        market: market.value,
        mode: config.mode,
        kind: 'decimal-error',
        action: 'config',
        reason: planned.error.message,
        result: planned.error.raw ?? planned.error.message,
      });
      return err(planned.error);
    }
    let result: unknown = null;
    const intent = planned.value;
    if (intent.kind === 'plan-buy') {
      const quantity = decimalDivStrict(intent.krwAmount, intent.limitPrice, 12);
      result = this.repo.createLot({
        accountId: input.accountId,
        market: market.value,
        source: 'dry-run',
        quantity,
        avgEntryKrw: intent.limitPrice,
        allocatedKrw: intent.krwAmount,
        openedAt: this.now(),
      });
    } else if (intent.kind === 'plan-sell') {
      const lot = this.repo
        .listOpenLots(input.accountId, market.value, 'dry-run')
        .find((entry) => entry.id === intent.lotId);
      if (lot) {
        const proceeds = decimalMulStrict(intent.quantity, intent.limitPrice);
        const realizedPnl = decimalSubStrict(proceeds, lot.allocatedKrw);
        this.repo.closeLot({ lotId: lot.id, realizedPnl, closedAt: this.now() });
        result = { lotId: lot.id, realizedPnl };
      }
    }
    this.repo.markDryRun(input.accountId, market.value, this.now());
    const event = this.repo.insertEvent({
      accountId: input.accountId,
      market: market.value,
      mode: 'dry-run',
      kind: 'dry-run',
      action: intent.kind,
      reason: intent.kind === 'noop' ? intent.reason : 'dry-run simulated',
      intent,
      result,
      createdAt: this.now(),
    });
    this.logger.log({
      level: 'INFO',
      category: 'ORDER',
      message: 'crypto.auto.dry-run',
      payload: { accountId: input.accountId, market: market.value, action: intent.kind },
    });
    return ok({
      accountId: input.accountId,
      market: market.value,
      mode: 'dry-run',
      intent,
      gate: { ok: true, blockedReasons: [] },
      event,
    });
  }

  async runLiveTick(
    input: CryptoAutoLiveTickInput,
  ): Promise<Result<CryptoAutoRunResult, CryptoExchangeError>> {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return err(market.error);
    const planned = this.plan({ ...input, lotSource: 'live' });
    if (planned.isErr()) return err(planned.error);
    const idempotencyKey = buildIdentifier({
      accountId: input.accountId,
      market: market.value,
      intent: planned.value,
      now: this.now(),
    });
    const gate = this.getGate({
      accountId: input.accountId,
      market: market.value,
      intent: planned.value,
      requireIdempotency: true,
      idempotencyKey,
    });
    if (gate.isErr()) return err(gate.error);
    if (!gate.value.ok || planned.value.kind === 'noop') {
      const event = this.repo.insertEvent({
        accountId: input.accountId,
        market: market.value,
        mode: 'live-small',
        kind: gate.value.ok ? 'live-place' : 'blocked',
        action: planned.value.kind,
        reason:
          planned.value.kind === 'noop'
            ? planned.value.reason
            : gate.value.blockedReasons.join(', '),
        intent: planned.value,
        result: gate.value,
        idempotencyKey,
        createdAt: this.now(),
      });
      return ok({
        accountId: input.accountId,
        market: market.value,
        mode: 'live-small',
        intent: planned.value,
        gate: gate.value,
        event,
      });
    }

    if (this.cryptoAutoBuyGuard && planned.value.kind === 'plan-buy') {
      try {
        this.cryptoAutoBuyGuard.assertAutoBuyAllowed({
          accountId: input.accountId,
          market: market.value,
          amountKrw: Number(planned.value.krwAmount),
          source: 'STRATEGY',
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const event = this.repo.insertEvent({
          accountId: input.accountId,
          market: market.value,
          mode: 'live-small',
          kind: 'blocked',
          action: planned.value.kind,
          reason,
          intent: planned.value,
          result: null,
          idempotencyKey,
          createdAt: this.now(),
        });
        return ok({
          accountId: input.accountId,
          market: market.value,
          mode: 'live-small',
          intent: planned.value,
          gate: gate.value,
          event,
        });
      }
    }

    let orderIntent: CryptoOrderIntent;
    if (planned.value.kind === 'plan-buy') {
      orderIntent = {
        market: market.value,
        side: 'bid',
        ordType: 'price',
        price: planned.value.krwAmount,
        identifier: idempotencyKey,
      };
    } else if (planned.value.kind === 'plan-sell') {
      orderIntent = {
        market: market.value,
        side: 'ask',
        ordType: 'market',
        volume: planned.value.quantity,
        identifier: idempotencyKey,
      };
    } else {
      return err(cryptoExchangeError('실행 가능한 live intent가 아닙니다.', planned.value));
    }
    const order = await input.adapter.createOrder(orderIntent);
    if (order.isErr()) return err(order.error);
    this.repo.markLiveAction(input.accountId, market.value, this.now());
    if (this.rateGuard && planned.value.kind === 'plan-buy') {
      this.rateGuard.recordBuy(input.accountId, market.value, this.now());
      const guard = this.rateGuard.checkAndPossiblyDisableAuto(input.accountId);
      if (guard.switchedToManual) {
        this.logger.log({
          level: 'WARN',
          category: 'ORDER',
          message: 'crypto.auto.rate-guard.disabled',
          payload: { accountId: input.accountId, market: market.value },
        });
      }
    }
    const event = this.repo.insertEvent({
      accountId: input.accountId,
      market: market.value,
      mode: 'live-small',
      kind: 'live-place',
      action: planned.value.kind,
      reason: 'live-small order placed',
      intent: planned.value,
      result: order.value,
      idempotencyKey,
      createdAt: this.now(),
    });
    this.logger.log({
      level: 'WARN',
      category: 'ORDER',
      message: 'crypto.auto.live-small.placed',
      payload: { accountId: input.accountId, market: market.value, action: planned.value.kind },
    });
    const orderUuid = (order.value as CryptoOrderSnapshot | { uuid?: string }).uuid;
    return ok({
      accountId: input.accountId,
      market: market.value,
      mode: 'live-small',
      intent: planned.value,
      gate: gate.value,
      event,
      ...(orderUuid !== undefined ? { orderUuid } : {}),
    });
  }

  markReadonlySmoke(input: {
    accountId: number;
    market: string;
    smoke: CryptoReadonlySmokeResult;
  }): void {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return;
    if (input.smoke.balances.ok && input.smoke.privateWs.ok && input.smoke.reconciliation.ok) {
      this.repo.markReadonlySmokeSucceeded(input.accountId, market.value, input.smoke.checkedAt);
      this.repo.insertEvent({
        accountId: input.accountId,
        market: market.value,
        mode: this.repo.getConfig(input.accountId, market.value).mode,
        kind: 'smoke',
        action: 'smoke',
        reason: 'read-only smoke succeeded',
        result: {
          balances: input.smoke.balances,
          privateWs: input.smoke.privateWs,
          reconciliation: input.smoke.reconciliation,
        },
        createdAt: input.smoke.checkedAt,
      });
    }
  }
}
