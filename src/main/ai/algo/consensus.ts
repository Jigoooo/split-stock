import type { ConsensusContext } from './types';

export function computeConsensus(ctx: ConsensusContext): {
  count: number;
  level: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'bullish' | 'bearish' | 'mixed' | 'none';
} {
  let bull = 0;
  let bear = 0;
  if (ctx.rsi !== null) {
    if (ctx.rsi <= ctx.T.rsiOversold) bull++;
    else if (ctx.rsi >= ctx.T.rsiOverbought) bear++;
  }
  if (ctx.bbPosition !== null) {
    if (ctx.bbPosition <= 0.1) bull++;
    else if (ctx.bbPosition >= 0.9) bear++;
  }
  if (ctx.mfi !== null) {
    if (ctx.mfi <= ctx.T.mfiOversold) bull++;
    else if (ctx.mfi >= ctx.T.mfiOverbought) bear++;
  }
  if (ctx.stoch) {
    if (ctx.stoch.k <= ctx.T.stochOversold) bull++;
    else if (ctx.stoch.k >= ctx.T.stochOverbought) bear++;
  }
  if (ctx.cci !== null) {
    if (ctx.cci <= -100) bull++;
    else if (ctx.cci >= 100) bear++;
  }
  if (ctx.divergence === 'bullish') bull++;
  else if (ctx.divergence === 'bearish') bear++;
  if (ctx.macd && ctx.macd.cross === 'golden') bull++;
  else if (ctx.macd && ctx.macd.cross === 'dead') bear++;

  const count = Math.max(bull, bear);
  let direction: 'bullish' | 'bearish' | 'mixed' | 'none';
  if (bull === 0 && bear === 0) direction = 'none';
  else if (bull > 0 && bear > 0) direction = 'mixed';
  else direction = bull > bear ? 'bullish' : 'bearish';

  let level: 'strong' | 'moderate' | 'weak' | 'none';
  if (count === 0) level = 'none';
  else if (count >= ctx.T.consensusStrong) level = 'strong';
  else if (count >= ctx.T.consensusModerate) level = 'moderate';
  else level = 'weak';

  return { count, level, direction };
}

export function detectConflicts(ctx: ConsensusContext): string[] {
  const conflicts: string[] = [];
  if (
    ctx.bbPosition !== null &&
    ctx.bbPosition >= 0.9 &&
    ctx.rsi !== null &&
    ctx.rsi <= ctx.T.rsiOversold
  ) {
    conflicts.push('BB 상단 + RSI 과매도 — 모순');
  }
  if (
    ctx.bbPosition !== null &&
    ctx.bbPosition <= 0.1 &&
    ctx.rsi !== null &&
    ctx.rsi >= ctx.T.rsiOverbought
  ) {
    conflicts.push('BB 하단 + RSI 과매수 — 모순');
  }
  if (ctx.aroon?.isStrongUpTrend) {
    conflicts.push(
      `Aroon up=${Math.round(ctx.aroon.up)} down=${Math.round(ctx.aroon.down)} — 강한 추세장, 매직스플릿 부적합 가능`,
    );
  }
  if (
    ctx.psar &&
    ctx.psar.trend === -1 &&
    ((ctx.rsi !== null && ctx.rsi <= ctx.T.rsiOversold) ||
      (ctx.bbPosition !== null && ctx.bbPosition <= 0.1))
  ) {
    conflicts.push('PSAR 하락 추세에서 oversold — 추세 거스르기 위험');
  }
  if (ctx.divergence === 'bearish' && ctx.bbPosition !== null && ctx.bbPosition <= 0.2) {
    conflicts.push('가격 하단 근접하지만 OBV 베어리시 다이버전스 — 추가 하락 주의');
  }
  return conflicts;
}
