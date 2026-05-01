import type { Candle, OrderbookSnapshot, Quote, StrategyProfile } from '@shared/contracts';
import { DEFAULT_STRATEGY_PROFILE } from '@shared/contracts';
import { roundToTick } from '@shared/market-rules/price-tick';
import { TRPCError } from '@trpc/server';
import { buildRangeCycleFacts, type RangeCycleFacts } from '../../ai/range-cycle-facts';
import type { BrokerPort } from '../../brokers/ports/broker-port';
import type { DailyCandle } from '../../trading/daily-candles-repo';
import type { StrategyEffectiveSource } from '../../trading/strategy-repo';
import type { Context } from '../context';
import { ensureActiveAccountId } from './watch-handler-shared';

type SourceState = 'used' | 'cache' | 'fetched' | 'failed' | 'unavailable';
type StrategySourceState = StrategyEffectiveSource | 'failed';
type PriceCandidateId = 'nearest-support' | 'box-low' | 'pullback-2';
const MAX_DEFAULT_DISCOUNT_PCT = 20;

export interface ReservationBuyDraftInput {
  accountId: number;
  pdno: string;
}

export interface ReservationBuyPriceCandidate {
  id: PriceCandidateId;
  label: string;
  price: number;
  distancePct: number;
  reason: string;
  confidence: 'high' | 'med' | 'low';
  strength?: number;
  zoneLow?: number;
  zoneHigh?: number;
  basis?: string;
}

export interface ReservationBuyDraft {
  quote: Quote | null;
  orderbookTop: {
    bestAsk: number | null;
    bestBid: number | null;
    expectedPrice: number | null;
  };
  rangeContext: {
    candleCount: number;
    dataQuality: RangeCycleFacts['dataQuality'];
    dataQualityReason: string;
    analysisConfidence: RangeCycleFacts['analysisConfidence'];
    lastClose: number | null;
    box: RangeCycleFacts['algo']['box'];
    supportResistance: RangeCycleFacts['algo']['supportResistance'];
    rangePct120d: number | null;
  };
  priceCandidates: ReservationBuyPriceCandidate[];
  recommended: {
    targetPrice: number | null;
    priceCandidateId: PriceCandidateId | null;
    orderType: 'LIMIT';
    qtyOrAmountMode: 'AMOUNT';
    amountKrw: number;
    expiresAtMs: number;
  };
  warnings: string[];
  sourceStatus: {
    quote: SourceState;
    orderbook: SourceState;
    candles: SourceState;
    strategy: StrategySourceState;
  };
}

export async function getReservationBuyDraft(
  ctx: Context,
  input: ReservationBuyDraftInput,
): Promise<ReservationBuyDraft> {
  const activeAccountId = ensureActiveAccountId(ctx.activeAccountId);
  if (input.accountId !== activeAccountId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '다른 계좌로의 자동감시주문 draft 조회는 허용되지 않습니다.',
    });
  }

  const broker = ctx.brokerForAccount(input.accountId);
  const sourceStatus: ReservationBuyDraft['sourceStatus'] = {
    quote: 'unavailable',
    orderbook: 'unavailable',
    candles: 'unavailable',
    strategy: 'default',
  };

  const [quote, orderbook] = await Promise.all([
    broker ? readQuote(broker, input.pdno) : Promise.resolve(null),
    broker ? readOrderbook(broker, input.pdno) : Promise.resolve(null),
  ]);
  sourceStatus.quote = broker ? (quote ? 'used' : 'failed') : 'unavailable';
  sourceStatus.orderbook = broker ? (orderbook ? 'used' : 'failed') : 'unavailable';

  const asOfDate = toKstYmd(new Date());
  const cachedCandles = ctx.candlesRepo.getInRange(
    input.pdno,
    'D',
    shiftYmd(asOfDate, -240),
    asOfDate,
  );
  if (cachedCandles.length > 0) {
    sourceStatus.candles = 'cache';
  } else if (broker) {
    const fetched = await readDailyCandles(broker, input.pdno, asOfDate);
    if (fetched.length > 0) {
      ctx.candlesRepo.upsertMany(input.pdno, 'D', fetched);
      sourceStatus.candles = 'fetched';
    } else {
      sourceStatus.candles = 'failed';
    }
  }

  const facts = buildRangeCycleFacts({
    candlesRepo: ctx.candlesRepo,
    pdnos: [input.pdno],
    asOfDate,
  })[0];
  if (!facts) {
    throw new Error(`예약매수 draft 생성 실패: ${input.pdno}`);
  }

  const strategyResult = ctx.strategyRepo.getEffectiveForEdit(input.accountId, input.pdno);
  const strategyProfile: StrategyProfile = strategyResult.isOk()
    ? strategyResult.value.profile
    : DEFAULT_STRATEGY_PROFILE;
  sourceStatus.strategy = strategyResult.isOk() ? strategyResult.value.source : 'failed';

  const referencePrice = quote?.price ?? facts.algo.lastClose ?? facts.stat.lastClose ?? null;
  const priceCandidates =
    facts.dataQuality === 'blocked' || referencePrice === null
      ? []
      : buildPriceCandidates(facts, referencePrice);
  const selectedCandidate = pickDefaultCandidate(priceCandidates);
  const warnings = buildWarnings(facts, quote, priceCandidates, selectedCandidate);

  return {
    quote,
    orderbookTop: toOrderbookTop(orderbook),
    rangeContext: {
      candleCount: facts.candleCount,
      dataQuality: facts.dataQuality,
      dataQualityReason: facts.dataQualityReason,
      analysisConfidence: facts.analysisConfidence,
      lastClose: facts.algo.lastClose ?? facts.stat.lastClose,
      box: facts.algo.box,
      supportResistance: facts.algo.supportResistance,
      rangePct120d: facts.stat.rangePct120d,
    },
    priceCandidates,
    recommended: {
      targetPrice: selectedCandidate?.price ?? null,
      priceCandidateId: selectedCandidate?.id ?? null,
      orderType: 'LIMIT',
      qtyOrAmountMode: 'AMOUNT',
      amountKrw:
        strategyProfile.buyRules[0]?.amountKrw ??
        DEFAULT_STRATEGY_PROFILE.buyRules[0]?.amountKrw ??
        1_000_000,
      expiresAtMs: addMonthsEndOfKstDayMs(3),
    },
    warnings,
    sourceStatus,
  };
}

export function buildPriceCandidates(
  facts: RangeCycleFacts,
  currentPrice: number,
): ReservationBuyPriceCandidate[] {
  if (currentPrice <= 0) return [];
  return [
    makeNearestSupportCandidate(facts, currentPrice),
    makeBoxLowCandidate(facts, currentPrice),
    makePullbackCandidate(currentPrice),
  ].filter((candidate): candidate is ReservationBuyPriceCandidate => candidate !== null);
}

function makeNearestSupportCandidate(
  facts: RangeCycleFacts,
  currentPrice: number,
): ReservationBuyPriceCandidate | null {
  const supports = facts.algo.supportResistance?.supports ?? [];
  const strongLevel =
    facts.algo.supportResistance?.levels
      .filter((level) => {
        if (level.kind !== 'support' || level.invalidated || level.price >= currentPrice)
          return false;
        const distancePct = ((level.price - currentPrice) / currentPrice) * 100;
        return level.strength >= 65 && distancePct <= -1 && distancePct >= -12;
      })
      .sort((a, b) => b.price - a.price)[0] ?? null;
  const level =
    strongLevel ??
    facts.algo.supportResistance?.nearestSupport ??
    supports
      .filter((price) => price < currentPrice)
      .sort((a, b) => b - a)
      .map((price) => ({
        price,
        strength: 50,
        zoneLow: price,
        zoneHigh: price,
        touchCount: 0,
        sources: [] as string[],
      }))[0];
  if (level === undefined || level.price >= currentPrice) return null;
  return candidateFromPrice({
    id: 'nearest-support',
    label: '지지선',
    price: level.price,
    currentPrice,
    reason:
      level.strength >= 65
        ? `강한 지지선(${level.touchCount}회 터치, 강도 ${level.strength})`
        : `현재가 아래 최근접 지지선(강도 ${level.strength})`,
    confidence:
      facts.analysisConfidence === 'high' && level.strength >= 70
        ? 'high'
        : level.strength >= 65
          ? 'med'
          : 'low',
    strength: level.strength,
    zoneLow: level.zoneLow,
    zoneHigh: level.zoneHigh,
    basis: level.sources.length > 0 ? level.sources.join('+') : 'pivot',
  });
}

function makeBoxLowCandidate(
  facts: RangeCycleFacts,
  currentPrice: number,
): ReservationBuyPriceCandidate | null {
  const box = facts.algo.box;
  if (!box) return null;
  const price = box.low;
  if (price === undefined || price === null) return null;
  return candidateFromPrice({
    id: 'box-low',
    label: '박스하단',
    price,
    currentPrice,
    reason:
      box.method === 'confluence'
        ? `검증된 박스하단(${box.touchesLow}회 터치, ${box.confidence})`
        : '최근 120일 percentile 박스 하단',
    confidence:
      facts.dataQuality === 'normal' && box.confidence === 'high'
        ? 'high'
        : facts.dataQuality === 'normal' && box.confidence === 'med'
          ? 'med'
          : 'low',
    strength: box.confidence === 'high' ? 80 : box.confidence === 'med' ? 65 : 45,
    zoneLow: box.low,
    zoneHigh: box.high,
    basis: box.method,
  });
}

function makePullbackCandidate(currentPrice: number): ReservationBuyPriceCandidate | null {
  return candidateFromPrice({
    id: 'pullback-2',
    label: '-2%',
    price: currentPrice * 0.98,
    currentPrice,
    reason: '현재가 기준 2% 눌림',
    confidence: 'low',
  });
}

function candidateFromPrice(input: {
  id: PriceCandidateId;
  label: string;
  price: number;
  currentPrice: number;
  reason: string;
  confidence: 'high' | 'med' | 'low';
  strength?: number;
  zoneLow?: number;
  zoneHigh?: number;
  basis?: string;
}): ReservationBuyPriceCandidate | null {
  const price = roundToTick(input.price, false);
  if (!Number.isFinite(price) || price <= 0 || price >= input.currentPrice) return null;
  return {
    id: input.id,
    label: input.label,
    price,
    distancePct: roundPct(((price - input.currentPrice) / input.currentPrice) * 100),
    reason: input.reason,
    confidence: input.confidence,
    ...(input.strength !== undefined ? { strength: input.strength } : {}),
    ...(input.zoneLow !== undefined ? { zoneLow: roundToTick(input.zoneLow, false) } : {}),
    ...(input.zoneHigh !== undefined ? { zoneHigh: roundToTick(input.zoneHigh, true) } : {}),
    ...(input.basis !== undefined ? { basis: input.basis } : {}),
  };
}

function pickDefaultCandidate(
  candidates: ReadonlyArray<ReservationBuyPriceCandidate>,
): ReservationBuyPriceCandidate | null {
  const priority: PriceCandidateId[] = ['nearest-support', 'box-low', 'pullback-2'];
  const actionableCandidates = candidates.filter(isDefaultEligibleCandidate);
  for (const id of priority) {
    const candidate = actionableCandidates.find((item) => item.id === id);
    if (candidate) return candidate;
  }
  return null;
}

function isActionableDefaultCandidate(candidate: ReservationBuyPriceCandidate): boolean {
  return candidate.distancePct >= -MAX_DEFAULT_DISCOUNT_PCT;
}

function isDefaultEligibleCandidate(candidate: ReservationBuyPriceCandidate): boolean {
  if (!isActionableDefaultCandidate(candidate)) return false;
  if (candidate.id === 'nearest-support') {
    return (
      (candidate.strength ?? 0) >= 65 && candidate.distancePct <= -1 && candidate.distancePct >= -12
    );
  }
  if (candidate.id === 'box-low') {
    return candidate.confidence !== 'low';
  }
  return true;
}

function buildWarnings(
  facts: RangeCycleFacts,
  quote: Quote | null,
  priceCandidates: ReadonlyArray<ReservationBuyPriceCandidate>,
  selectedCandidate: ReservationBuyPriceCandidate | null,
): string[] {
  const warnings: string[] = [];
  if (facts.dataQuality === 'blocked') {
    warnings.push('일봉 30개 미만으로 감시가격 자동 추천을 보류했습니다.');
  } else if (facts.dataQuality === 'limited') {
    warnings.push('일봉 30~59개 제한 분석입니다. 추천가는 보수적으로 확인하세요.');
  }
  if (quote && selectedCandidate && selectedCandidate.price >= quote.price) {
    warnings.push('추천 감시가격이 현재가 이상입니다. 저장 직후 실행될 수 있습니다.');
  }
  const hasDistantStructuralCandidate = priceCandidates.some(
    (candidate) => candidate.id !== 'pullback-2' && !isActionableDefaultCandidate(candidate),
  );
  if (selectedCandidate?.id === 'pullback-2' && hasDistantStructuralCandidate) {
    warnings.push('지지선/박스하단이 현재가 대비 20% 이상 멀어 근접 눌림가를 기본 추천했습니다.');
  }
  return warnings;
}

async function readQuote(broker: BrokerPort, pdno: string): Promise<Quote | null> {
  const result = await broker.getQuote(pdno);
  return result.isOk() ? result.value : null;
}

async function readOrderbook(broker: BrokerPort, pdno: string): Promise<OrderbookSnapshot | null> {
  const result = await broker.getOrderbook(pdno);
  return result.isOk() ? result.value : null;
}

async function readDailyCandles(
  broker: BrokerPort,
  pdno: string,
  asOfDate: string,
): Promise<DailyCandle[]> {
  const to = new Date(`${asOfDate}T23:59:59+09:00`);
  const from = new Date(to);
  from.setDate(from.getDate() - 240);
  const result = await broker.getDailyOhlcv({ symbol: pdno, from, to, period: 'D' });
  if (result.isErr()) return [];
  return result.value.map(toDailyCandle);
}

function toDailyCandle(candle: Candle): DailyCandle {
  return {
    date: normalizeCandleDate(candle.date),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function normalizeCandleDate(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
}

function toOrderbookTop(orderbook: OrderbookSnapshot | null): ReservationBuyDraft['orderbookTop'] {
  return {
    bestAsk: orderbook?.asks[0]?.price ?? null,
    bestBid: orderbook?.bids[0]?.price ?? null,
    expectedPrice: orderbook?.expectedPrice ?? null,
  };
}

function addMonthsEndOfKstDayMs(months: number): number {
  const base = new Date(`${toKstYmd(new Date())}T00:00:00+09:00`);
  base.setMonth(base.getMonth() + months);
  const ymd = toKstYmd(base);
  return Date.parse(`${ymd}T23:59:59+09:00`);
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function shiftYmd(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return toKstYmd(d);
}

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
