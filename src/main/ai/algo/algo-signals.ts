import type { DailyCandle, DailyCandlesRepo } from '../../trading/daily-candles-repo';

export interface AlgoSignals {
  pdno: string;
  /** 매직스플릿 적합도 종합 점수 0~100. 결정론적, LLM 무관. */
  splitScore: number | null;
  /** 점수의 세부 컴포넌트 — UI/LLM 양쪽이 사용. */
  components: {
    volatility: number | null; // 0~100
    liquidity: number | null;
    range: number | null;
  };
  /** 박스권 자동 탐지 — 매직스플릿 차수 진입가 산출 보조. */
  box: { high: number; low: number; mid: number } | null;
  /** 단순 RSI(14). 70+ 과매수, 30- 과매도. */
  rsi14: number | null;
  /** 5일 평균 거래량 / 60일 평균 거래량 비율 — 1.5+ spike 신호. */
  volumeSpikeRatio: number | null;
  /** 단순 모멘텀 — 20일 수익률 (%). */
  momentum20d: number | null;
  /** 사람 읽을 수 있는 라벨. UI/LLM input 모두 노출. */
  labels: string[];
}

export interface AlgoSignalsInput {
  candlesRepo: DailyCandlesRepo;
  pdnos: ReadonlyArray<string>;
  /** YYYY-MM-DD. 기본 오늘 KST. */
  asOfDate?: string;
}

/**
 * 매직스플릿 적합도 + 보조 신호 — LLM 호출 전에 결정론적으로 계산되어
 * (a) 사전 ranking + (b) LLM 입력 컨텍스트 + (c) AI off 모드의 최종 출력 모두에 활용.
 *
 * 후보를 삭제하지 않고 모든 종목에 신호를 첨부 — LLM 이 순위 결정 자유 유지.
 */
export function computeAlgoSignals(input: AlgoSignalsInput): AlgoSignals[] {
  const asOf = input.asOfDate ?? toKstYmd(new Date());
  const from = shiftYmd(asOf, -180);

  return input.pdnos.map((pdno) => {
    const candles = input.candlesRepo.getInRange(pdno, 'D', from, asOf);
    if (candles.length < 30) {
      return {
        pdno,
        splitScore: null,
        components: { volatility: null, liquidity: null, range: null },
        box: null,
        rsi14: null,
        volumeSpikeRatio: null,
        momentum20d: null,
        labels: ['데이터 부족'],
      };
    }
    const c60 = candles.slice(-60);
    const c120 = candles.slice(-120);
    const c20 = candles.slice(-20);
    const c5 = candles.slice(-5);

    const volPct = annualizedVolPct(c60);
    const avgVol = avgVolume(c60);
    const rangePct = rangePct120(c120);
    const box = computeBox(c120);
    const rsi = rsi14(candles);
    const spike = volumeSpikeRatio(c5, c60);
    const momentum = momentum20d(c20);

    const components = {
      volatility: scoreVolatility(volPct),
      liquidity: scoreLiquidity(avgVol),
      range: scoreRange(rangePct),
    };
    const splitScore = combineScore(components);
    const labels = buildLabels({ volPct, rangePct, rsi, spike, momentum });

    return {
      pdno,
      splitScore,
      components,
      box,
      rsi14: rsi,
      volumeSpikeRatio: spike,
      momentum20d: momentum,
      labels,
    };
  });
}

function annualizedVolPct(candles: ReadonlyArray<DailyCandle>): number | null {
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]?.close ?? 0;
    const curr = candles[i]?.close ?? 0;
    if (prev > 0) returns.push(curr / prev - 1);
  }
  if (returns.length < 5) return null;
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
}

function avgVolume(candles: ReadonlyArray<DailyCandle>): number {
  if (candles.length === 0) return 0;
  return Math.round(candles.reduce((s, c) => s + c.volume, 0) / candles.length);
}

function rangePct120(candles: ReadonlyArray<DailyCandle>): number | null {
  let max = -Infinity;
  let min = Infinity;
  for (const c of candles) {
    if (c.high > max) max = c.high;
    if (c.low < min) min = c.low;
  }
  if (!Number.isFinite(max) || !Number.isFinite(min) || min <= 0) return null;
  const mid = (max + min) / 2;
  return Math.round(((max - min) / mid) * 10000) / 100;
}

function computeBox(
  candles: ReadonlyArray<DailyCandle>,
): { high: number; low: number; mid: number } | null {
  let max = -Infinity;
  let min = Infinity;
  for (const c of candles) {
    if (c.high > max) max = c.high;
    if (c.low < min) min = c.low;
  }
  if (!Number.isFinite(max) || !Number.isFinite(min)) return null;
  return { high: max, low: min, mid: Math.round((max + min) / 2) };
}

function rsi14(candles: ReadonlyArray<DailyCandle>): number | null {
  if (candles.length < 15) return null;
  const recent = candles.slice(-15);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]?.close ?? 0;
    const curr = recent[i]?.close ?? 0;
    const diff = curr - prev;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  if (gains + losses === 0) return 50;
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function volumeSpikeRatio(
  recent5: ReadonlyArray<DailyCandle>,
  base60: ReadonlyArray<DailyCandle>,
): number | null {
  if (recent5.length === 0 || base60.length < 30) return null;
  const r5 = recent5.reduce((s, c) => s + c.volume, 0) / recent5.length;
  const r60 = base60.reduce((s, c) => s + c.volume, 0) / base60.length;
  if (r60 <= 0) return null;
  return Math.round((r5 / r60) * 100) / 100;
}

function momentum20d(c20: ReadonlyArray<DailyCandle>): number | null {
  if (c20.length < 2) return null;
  const first = c20[0]?.close ?? 0;
  const last = c20[c20.length - 1]?.close ?? 0;
  if (first <= 0) return null;
  return Math.round((last / first - 1) * 10000) / 100;
}

function scoreVolatility(volPct: number | null): number | null {
  if (volPct === null) return null;
  // 매직스플릿 sweet spot: 18~35%. 너무 낮으면 트리거 부족, 너무 높으면 손실 위험.
  if (volPct < 10) return Math.round(volPct * 4); // 0~40
  if (volPct <= 18) return 60 + Math.round(((volPct - 10) / 8) * 30); // 60~90
  if (volPct <= 35) return 100 - Math.round(((volPct - 18) / 17) * 10); // 100→90
  if (volPct <= 60) return 80 - Math.round(((volPct - 35) / 25) * 50); // 80→30
  return Math.max(0, 30 - Math.round((volPct - 60) / 2));
}

function scoreLiquidity(avgVol: number): number | null {
  if (avgVol <= 0) return 0;
  // 거래량 1만 미만 25점, 10만 60점, 100만 80점, 1000만+ 100점.
  if (avgVol < 10_000) return Math.min(40, Math.round(avgVol / 250));
  if (avgVol < 100_000) return 40 + Math.round(((avgVol - 10_000) / 90_000) * 20);
  if (avgVol < 1_000_000) return 60 + Math.round(((avgVol - 100_000) / 900_000) * 20);
  if (avgVol < 10_000_000) return 80 + Math.round(((avgVol - 1_000_000) / 9_000_000) * 15);
  return Math.min(100, 95 + Math.round(Math.log10(avgVol / 10_000_000)));
}

function scoreRange(rangePct: number | null): number | null {
  if (rangePct === null) return null;
  // 박스권 폭 sweet spot 25~50% — 차수 간격 설계 쉬움.
  if (rangePct < 10) return Math.round(rangePct * 5);
  if (rangePct <= 25) return 50 + Math.round(((rangePct - 10) / 15) * 40);
  if (rangePct <= 50) return 100 - Math.round(((rangePct - 25) / 25) * 10); // 100→90
  if (rangePct <= 80) return 90 - Math.round(((rangePct - 50) / 30) * 50);
  return Math.max(0, 40 - Math.round((rangePct - 80) / 5));
}

function combineScore(c: {
  volatility: number | null;
  liquidity: number | null;
  range: number | null;
}): number | null {
  const parts = [c.volatility, c.liquidity, c.range].filter((v): v is number => v !== null);
  if (parts.length === 0) return null;
  // 변동성 0.4 + 유동성 0.3 + 박스권 0.3 가중. 누락 시 균등 평균.
  const weights =
    c.volatility !== null && c.liquidity !== null && c.range !== null
      ? [0.4, 0.3, 0.3]
      : parts.map(() => 1 / parts.length);
  const ordered = [c.volatility, c.liquidity, c.range].filter((v): v is number => v !== null);
  let sum = 0;
  for (let i = 0; i < ordered.length; i++) {
    sum += (ordered[i] ?? 0) * (weights[i] ?? 0);
  }
  return Math.round(sum);
}

function buildLabels(args: {
  volPct: number | null;
  rangePct: number | null;
  rsi: number | null;
  spike: number | null;
  momentum: number | null;
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
    if (args.rsi >= 70) labels.push(`RSI ${args.rsi} 과매수`);
    else if (args.rsi <= 30) labels.push(`RSI ${args.rsi} 과매도`);
  }
  if (args.spike !== null && args.spike >= 1.5) {
    labels.push(`거래량 spike ${args.spike}x`);
  }
  if (args.momentum !== null) {
    if (args.momentum >= 10) labels.push(`20일 +${args.momentum}%`);
    else if (args.momentum <= -10) labels.push(`20일 ${args.momentum}%`);
  }
  return labels;
}

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
