import {
  type CryptoAutoConfig,
  type CryptoAutoGateResult,
  CryptoAutoGuardConfigSchema,
  type CryptoAutoIntent,
  CryptoAutoIntentSchema,
  type CryptoAutoRunResult,
  type CryptoBalance,
  type CryptoExchangeError,
  CryptoKrwMarketCodeSchema,
  type CryptoOrderIntent,
  type CryptoOrderSnapshot,
  type CryptoReadonlySmokeResult,
} from '@shared/contracts';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { EventLogger } from '../logging/event-logger';
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
}

export interface CryptoAutoTickInput {
  accountId: number;
  market: string;
  balances: CryptoBalance[];
  tradePrice: string;
}

export interface CryptoAutoLiveTickInput extends CryptoAutoTickInput {
  adapter: CryptoAutoLiveAdapter;
}

export interface CryptoAutoCancelInput {
  accountId: number;
  market: string;
  adapter: CryptoAutoLiveAdapter;
  uuid?: string;
  identifier?: string;
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
      cryptoExchangeError('자동매매는 Upbit KRW 마켓만 지원합니다.', parsed.error.flatten()),
    );
  }
  return ok(parsed.data);
}

function ensureConfig(config: CryptoAutoConfig): Result<CryptoAutoConfig, CryptoExchangeError> {
  const parsed = CryptoAutoGuardConfigSchema.safeParse(config);
  if (!parsed.success) {
    return err(
      cryptoExchangeError('코인 자동매매 설정이 올바르지 않습니다.', parsed.error.flatten()),
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

export class CryptoAutoTradingService {
  private readonly repo: CryptoAutoTradingRepo;
  private readonly logger: EventLogger;
  private readonly now: () => number;

  constructor(options: CryptoAutoServiceOptions) {
    this.repo = options.repo;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
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
        openExposureKrw(this.repo.listOpenLots(input.accountId, market.value)),
        input.intent.krwAmount,
      );
      if (decimalGtStrict(nextExposure, config.maxTotalExposureKrw)) {
        blockedReasons.push('총 노출 KRW 상한을 초과했습니다.');
      }
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
    const lots = this.repo.listOpenLots(input.accountId, market.value);
    const sellLot = lots.find((lot) => {
      const target = decimalMulStrict(lot.avgEntryKrw, decimalAddStrict('1', config.takeProfitPct));
      return decimalGteStrict(input.tradePrice, target);
    });
    if (sellLot) {
      return ok({
        kind: 'plan-sell',
        market: market.value,
        lotId: sellLot.id,
        quantity: sellLot.quantity,
        limitPrice: priceCeil,
      });
    }

    const quoteAmount = decimalLteStrict(config.baseOrderKrw, config.maxOrderKrw)
      ? config.baseOrderKrw
      : config.maxOrderKrw;
    const quoteAvailable = availableKrw(input.balances);
    if (!decimalGteStrict(quoteAvailable, quoteAmount)) {
      return ok({ kind: 'noop', market: market.value, reason: 'KRW 주문 가능 잔고가 부족합니다.' });
    }
    if (!decimalGteStrict(quoteAmount, config.minOrderTotalKrw)) {
      return ok({
        kind: 'noop',
        market: market.value,
        reason: '기본 주문금액이 최소 주문금액 미만입니다.',
      });
    }
    if (lots.length === 0) {
      return ok({
        kind: 'plan-buy',
        market: market.value,
        krwAmount: quoteAmount,
        limitPrice: priceFloor,
      });
    }
    if (lots.length >= config.maxOpenLots) {
      return ok({ kind: 'noop', market: market.value, reason: '최대 open lot 수에 도달했습니다.' });
    }
    const lowestEntry = lots
      .map((lot) => lot.avgEntryKrw)
      .sort((left, right) => (decimalGtStrict(left, right) ? 1 : -1))[0];
    if (lowestEntry) {
      const addTrigger = decimalMulStrict(lowestEntry, decimalSubStrict('1', config.addTriggerPct));
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
    const planned = this.plan(input);
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
        quantity,
        avgEntryKrw: intent.limitPrice,
        allocatedKrw: intent.krwAmount,
        openedAt: this.now(),
      });
    } else if (intent.kind === 'plan-sell') {
      const lot = this.repo
        .listOpenLots(input.accountId, market.value)
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
    const planned = this.plan(input);
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

  async cancelLiveOrder(
    input: CryptoAutoCancelInput,
  ): Promise<Result<CryptoAutoRunResult, CryptoExchangeError>> {
    const market = safeKrwMarket(input.market);
    if (market.isErr()) return err(market.error);
    const intent = CryptoAutoIntentSchema.parse({
      kind: 'cancel-stale',
      market: market.value,
      orderId: input.uuid ?? input.identifier ?? '',
      reason: 'manual auto cancel',
    });
    const idempotencyKey = buildIdentifier({
      accountId: input.accountId,
      market: market.value,
      intent,
      now: this.now(),
    });
    const gate = this.getGate({
      accountId: input.accountId,
      market: market.value,
      intent,
      requireIdempotency: true,
      idempotencyKey,
    });
    if (gate.isErr()) return err(gate.error);
    if (!gate.value.ok) {
      const event = this.repo.insertEvent({
        accountId: input.accountId,
        market: market.value,
        mode: 'live-small',
        kind: 'blocked',
        action: intent.kind,
        reason: gate.value.blockedReasons.join(', '),
        intent,
        result: gate.value,
        idempotencyKey,
        createdAt: this.now(),
      });
      return ok({
        accountId: input.accountId,
        market: market.value,
        mode: 'live-small',
        intent,
        gate: gate.value,
        event,
      });
    }
    const cancelled = await input.adapter.cancelOrder({
      ...(input.uuid !== undefined ? { uuid: input.uuid } : {}),
      ...(input.identifier !== undefined ? { identifier: input.identifier } : {}),
    });
    if (cancelled.isErr()) return err(cancelled.error);
    this.repo.markLiveAction(input.accountId, market.value, this.now());
    const event = this.repo.insertEvent({
      accountId: input.accountId,
      market: market.value,
      mode: 'live-small',
      kind: 'live-cancel',
      action: intent.kind,
      reason: 'live-small order cancelled',
      intent,
      result: cancelled.value,
      idempotencyKey,
      createdAt: this.now(),
    });
    return ok({
      accountId: input.accountId,
      market: market.value,
      mode: 'live-small',
      intent,
      gate: gate.value,
      event,
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
