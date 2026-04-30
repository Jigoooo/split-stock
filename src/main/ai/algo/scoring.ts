import { round, round1 } from './math-utils';
import type { AlgoThresholds } from './types';

export function scoreVolatility(volPct: number | null): number | null {
  if (volPct === null) return null;
  if (volPct < 10) return Math.round(volPct * 4);
  if (volPct <= 18) return 60 + Math.round(((volPct - 10) / 8) * 30);
  if (volPct <= 35) return 100 - Math.round(((volPct - 18) / 17) * 10);
  if (volPct <= 60) return 80 - Math.round(((volPct - 35) / 25) * 50);
  return Math.max(0, 30 - Math.round((volPct - 60) / 2));
}

export function scoreLiquidity(avgVol: number): number | null {
  if (avgVol <= 0) return 0;
  if (avgVol < 10_000) return Math.min(40, Math.round(avgVol / 250));
  if (avgVol < 100_000) return 40 + Math.round(((avgVol - 10_000) / 90_000) * 20);
  if (avgVol < 1_000_000) return 60 + Math.round(((avgVol - 100_000) / 900_000) * 20);
  if (avgVol < 10_000_000) return 80 + Math.round(((avgVol - 1_000_000) / 9_000_000) * 15);
  return Math.min(100, 95 + Math.round(Math.log10(avgVol / 10_000_000)));
}

export function scoreRange(rangePct: number | null): number | null {
  if (rangePct === null) return null;
  if (rangePct < 10) return Math.round(rangePct * 5);
  if (rangePct <= 25) return 50 + Math.round(((rangePct - 10) / 15) * 40);
  if (rangePct <= 50) return 100 - Math.round(((rangePct - 25) / 25) * 10);
  if (rangePct <= 80) return 90 - Math.round(((rangePct - 50) / 30) * 50);
  return Math.max(0, 40 - Math.round((rangePct - 80) / 5));
}

export function scoreBbPosition(position: number | null): number | null {
  if (position === null) return null;
  if (position < 0) return 100;
  if (position > 1) return 30;
  return Math.round(100 - 70 * position);
}

export function scoreSupportProx(
  sr: { nearestSupportPct: number | null; nearestResistancePct: number | null } | null,
): number | null {
  if (!sr || sr.nearestSupportPct === null) return null;
  const pct = sr.nearestSupportPct;
  if (pct <= 1) return 100;
  if (pct <= 3) return 90 - Math.round(((pct - 1) / 2) * 20);
  if (pct <= 7) return 70 - Math.round(((pct - 3) / 4) * 30);
  if (pct <= 15) return 40 - Math.round(((pct - 7) / 8) * 30);
  return Math.max(0, 10 - Math.round((pct - 15) / 5));
}

export function combineScore(c: {
  volatility: number | null;
  liquidity: number | null;
  range: number | null;
  bbPosition: number | null;
  supportProx: number | null;
}): number | null {
  const weights = {
    volatility: 0.3,
    liquidity: 0.2,
    range: 0.2,
    bbPosition: 0.15,
    supportProx: 0.15,
  };
  let sum = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = c[key as keyof typeof c];
    if (value !== null) {
      sum += value * weight;
      weightSum += weight;
    }
  }
  if (weightSum === 0) return null;
  return Math.round(sum / weightSum);
}

export function computeConfidence(
  candleCount: number,
  enoughForFull: boolean,
  T: AlgoThresholds,
): 'high' | 'med' | 'low' {
  if (candleCount < T.minCandlesForBasic) return 'low';
  if (!enoughForFull) return 'low';
  if (candleCount >= 90) return 'high';
  return 'med';
}

export function buildLabels(args: {
  volPct: number | null;
  rangePct: number | null;
  rsi: number | null;
  spike: number | null;
  momentum: number | null;
  aroon: { up: number; down: number; isStrongUpTrend: boolean } | null;
  mfi: number | null;
  consensusLevel: 'strong' | 'moderate' | 'weak' | 'none';
}): string[] {
  const labels: string[] = [];
  if (args.volPct !== null) {
    if (args.volPct < 12) labels.push('변동성 낮음');
    else if (args.volPct > 40) labels.push('변동성 높음');
    else labels.push('변동성 적정');
  }
  if (args.rangePct !== null) {
    if (args.rangePct < 12) labels.push('박스권 좁음');
    else if (args.rangePct > 60) labels.push('박스권 넓음');
  }
  if (args.rsi !== null) {
    if (args.rsi >= 70) labels.push(`RSI ${round1(args.rsi)} 과매수`);
    else if (args.rsi <= 30) labels.push(`RSI ${round1(args.rsi)} 과매도`);
  }
  if (args.spike !== null && args.spike >= 1.5) labels.push(`거래량 spike ${args.spike}x`);
  if (args.momentum !== null) {
    if (args.momentum >= 10) labels.push(`20일 +${args.momentum}%`);
    else if (args.momentum <= -10) labels.push(`20일 ${args.momentum}%`);
  }
  if (args.aroon?.isStrongUpTrend) labels.push('강한 추세장');
  if (args.mfi !== null) {
    if (args.mfi >= 80) labels.push(`MFI ${round1(args.mfi)} 과매수`);
    else if (args.mfi <= 20) labels.push(`MFI ${round1(args.mfi)} 과매도`);
  }
  if (args.consensusLevel === 'strong') labels.push('합의 강함');
  return labels;
}

export function buildIndicatorReasons(args: {
  rsi: number | null;
  bbPosition: number | null;
  mfi: number | null;
  stoch: { k: number; d: number } | null;
  aroon: { up: number; down: number; isStrongUpTrend: boolean } | null;
  macd: { cross: 'golden' | 'dead' | 'none'; histogram: number } | null;
  psar: { trend: 1 | -1; value: number } | null;
  momentum: number | null;
  divergence: 'bullish' | 'bearish' | 'none';
  atr: number | null;
  cci: number | null;
  supportResistance: {
    nearestSupportPct: number | null;
    nearestResistancePct: number | null;
  } | null;
  T: AlgoThresholds;
}): Array<{ indicator: string; value: string; meaning: string }> {
  return [...oscillatorReasons(args), ...trendReasons(args), ...rangeReasons(args)];
}

function oscillatorReasons(args: Parameters<typeof buildIndicatorReasons>[0]) {
  const out: Array<{ indicator: string; value: string; meaning: string }> = [];
  if (args.rsi !== null) {
    let meaning = '중립권';
    if (args.rsi <= args.T.rsiOversold) meaning = '과매도 — 분할매수 1차 매력';
    else if (args.rsi >= args.T.rsiOverbought) meaning = '과매수 — 추격 매수 위험';
    out.push({ indicator: 'RSI(14)', value: round1(args.rsi).toString(), meaning });
  }
  if (args.mfi !== null) {
    let meaning = '중립권';
    if (args.mfi <= args.T.mfiOversold) meaning = '거래량 동반 과매도';
    else if (args.mfi >= args.T.mfiOverbought) meaning = '거래량 동반 과매수';
    out.push({ indicator: 'MFI(14)', value: round1(args.mfi).toString(), meaning });
  }
  if (args.stoch) {
    let meaning = '중립권';
    if (args.stoch.k <= args.T.stochOversold) meaning = '과매도 영역';
    else if (args.stoch.k >= args.T.stochOverbought) meaning = '과매수 영역';
    out.push({
      indicator: 'Stochastic',
      value: `K=${round1(args.stoch.k)} D=${round1(args.stoch.d)}`,
      meaning,
    });
  }
  if (args.cci !== null) {
    let meaning = '중립권';
    if (args.cci <= -100) meaning = '과매도 영역';
    else if (args.cci >= 100) meaning = '과매수 영역';
    out.push({ indicator: 'CCI(20)', value: round1(args.cci).toString(), meaning });
  }
  return out;
}

function trendReasons(args: Parameters<typeof buildIndicatorReasons>[0]) {
  const out: Array<{ indicator: string; value: string; meaning: string }> = [];
  if (args.aroon) {
    out.push({
      indicator: 'Aroon(25)',
      value: `up=${Math.round(args.aroon.up)} down=${Math.round(args.aroon.down)}`,
      meaning: args.aroon.isStrongUpTrend
        ? '강한 상승 추세 — 매직스플릿 부적합 가능'
        : '추세 약함 — 박스권 매매 적합',
    });
  }
  if (args.macd) {
    const meaning =
      args.macd.cross === 'golden'
        ? '골든크로스 — 매수 모멘텀'
        : args.macd.cross === 'dead'
          ? '데드크로스 — 매도 모멘텀'
          : '교차 없음';
    out.push({ indicator: 'MACD', value: `hist=${round1(args.macd.histogram)}`, meaning });
  }
  if (args.psar) {
    out.push({
      indicator: 'PSAR',
      value: `${args.psar.value} (${args.psar.trend === 1 ? '상승' : '하락'})`,
      meaning: args.psar.trend === 1 ? '상승 추세 — PSAR 가 손절선' : '하락 추세 — 추가 하락 위험',
    });
  }
  if (args.divergence !== 'none') {
    out.push({
      indicator: 'OBV 다이버전스',
      value: args.divergence,
      meaning:
        args.divergence === 'bullish'
          ? '가격↘ + OBV↗ — 반등 가능성'
          : '가격↗ + OBV↘ — 추가 하락 주의',
    });
  }
  return out;
}

function rangeReasons(args: Parameters<typeof buildIndicatorReasons>[0]) {
  const out: Array<{ indicator: string; value: string; meaning: string }> = [];
  if (args.bbPosition !== null) {
    let meaning = '밴드 중앙 근처';
    if (args.bbPosition <= 0.1) meaning = '하단 근접 — 분할매수 1차 매력';
    else if (args.bbPosition >= 0.9) meaning = '상단 근접 — 차익 영역';
    out.push({ indicator: 'BB position', value: `${round1(args.bbPosition * 100)}%`, meaning });
  }
  if (args.momentum !== null) {
    let meaning = '단기 횡보';
    if (args.momentum >= 10) meaning = '단기 강세';
    else if (args.momentum <= -10) meaning = '단기 약세 — 분할매수 매력';
    out.push({ indicator: '20일 모멘텀', value: `${args.momentum}%`, meaning });
  }
  if (args.atr !== null) {
    out.push({
      indicator: 'ATR(14)',
      value: round(args.atr).toString(),
      meaning: `차수 간격 추천: ATR×1.5 ≈ ${Math.round(args.atr * 1.5)} 원 하락 시 진입`,
    });
  }
  const supportPct = args.supportResistance?.nearestSupportPct ?? null;
  if (supportPct !== null) {
    out.push({
      indicator: '최근접 지지선',
      value: `-${supportPct}%`,
      meaning: supportPct <= 3 ? '지지 근접 — 1차 매수 검토' : '지지선 멀음',
    });
  }
  const resistancePct = args.supportResistance?.nearestResistancePct ?? null;
  if (resistancePct !== null) {
    out.push({
      indicator: '최근접 저항선',
      value: `+${resistancePct}%`,
      meaning: resistancePct <= 3 ? '저항 근접 — 차익실현 영역' : '저항 여유 있음',
    });
  }
  return out;
}
