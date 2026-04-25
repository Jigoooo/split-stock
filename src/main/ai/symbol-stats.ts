import type { DailyCandle, DailyCandlesRepo } from '../trading/daily-candles-repo';

export interface SymbolStat {
  pdno: string;
  /** 마지막 종가 (있으면). */
  lastClose: number | null;
  /** 60일 변동성 — std(daily return) * sqrt(252) * 100 (%). */
  volatility60d: number | null;
  /** 60일 평균 거래량 (정수). */
  avgVolume60d: number | null;
  /** 120일 박스권 폭 — (max(high) - min(low)) / mid * 100 (%). */
  rangePct120d: number | null;
  /** 데이터 부족이면 사유. */
  dataReason: string | null;
}

export interface SymbolStatsInput {
  candlesRepo: DailyCandlesRepo;
  pdnos: ReadonlyArray<string>;
  /** 통계 산출 종료일 — YYYY-MM-DD. 기본 today(KST). */
  asOfDate?: string;
}

/**
 * 매직스플릿 적합도 판단을 위한 종목별 기초 통계.
 *
 * 입력 후보 풀 각 pdno 에 대해 캐시된 일봉으로 60/120일 통계 산출.
 * 캐시 미스(데이터 부족) 시 dataReason 만 채우고 nullable 통계 반환 — LLM 프롬프트에서
 * "데이터 부족" 케이스로 처리.
 *
 * 의도적 단순화:
 *  - KIS 추가 호출 X — 이미 차트에 캐시된 봉만 사용. 새 fetch 트리거 안 함.
 *  - 변동성은 정규분포 가정 std (단순). 매직스플릿 감수성 평가에 충분.
 */
export function computeSymbolStats(input: SymbolStatsInput): SymbolStat[] {
  const asOf = input.asOfDate ?? toKstYmd(new Date());
  const from120 = shiftYmd(asOf, -180); // 영업일 여유분
  const from60 = shiftYmd(asOf, -90);

  return input.pdnos.map((pdno) => {
    const candles120 = input.candlesRepo.getInRange(pdno, 'D', from120, asOf);
    if (candles120.length < 30) {
      return {
        pdno,
        lastClose: null,
        volatility60d: null,
        avgVolume60d: null,
        rangePct120d: null,
        dataReason: `일봉 캐시 부족(${candles120.length}/30)`,
      };
    }
    const candles60 = candles120.filter((c) => c.date >= from60);
    const lastClose = candles120[candles120.length - 1]?.close ?? null;

    return {
      pdno,
      lastClose,
      volatility60d: candles60.length >= 30 ? annualizedVolPct(candles60) : null,
      avgVolume60d: candles60.length > 0 ? avgVolume(candles60) : null,
      rangePct120d: rangePct(candles120),
      dataReason: null,
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
  const std = Math.sqrt(variance);
  return Math.round(std * Math.sqrt(252) * 10000) / 100; // %, 소수 둘째
}

function avgVolume(candles: ReadonlyArray<DailyCandle>): number {
  const sum = candles.reduce((s, c) => s + c.volume, 0);
  return Math.round(sum / candles.length);
}

function rangePct(candles: ReadonlyArray<DailyCandle>): number | null {
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

function toKstYmd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
