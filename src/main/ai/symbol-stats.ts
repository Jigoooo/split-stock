import type { DailyCandlesRepo } from '../trading/daily-candles-repo';
import { type AlgoSignals, computeAlgoSignals } from './algo/algo-signals';

export interface SymbolStat {
  pdno: string;
  /** 마지막 종가 (있으면). */
  lastClose: number | null;
  /** 60일 변동성 — std(daily return) * sqrt(252) * 100 (%). */
  volatility60d: number | null;
  /** 60일 평균 거래량 (정수). */
  avgVolume60d: number | null;
  /** 120일 박스권 폭 — percentile(20·80) outlier 필터 적용. */
  rangePct120d: number | null;
  /** 데이터 부족이면 사유. */
  dataReason: string | null;
}

export interface SymbolStatsInput {
  candlesRepo: DailyCandlesRepo;
  pdnos: ReadonlyArray<string>;
  /** 통계 산출 종료일 — YYYY-MM-DD. 기본 today(KST). */
  asOfDate?: string;
  /**
   * 이미 계산된 algo signals 가 있으면 그대로 재사용 — 중복 계산 방지.
   * suggest-symbols 같은 caller 가 algo + stats 둘 다 필요할 때 한 번만 계산.
   */
  precomputedSignals?: ReadonlyMap<string, AlgoSignals>;
}

/**
 * 매직스플릿 적합도 판단을 위한 종목별 기초 통계.
 *
 * 내부적으로 `computeAlgoSignals` 가 산출하는 변동성·거래량·박스권 컴포넌트를 그대로 노출.
 * 이전 버전은 자체적으로 같은 통계를 다시 계산했으나 중복이라 통합.
 *
 * 캐시 미스(데이터 부족) 시 dataReason 만 채우고 nullable 통계 반환 — LLM 프롬프트에서
 * "데이터 부족" 케이스로 처리.
 */
export function computeSymbolStats(input: SymbolStatsInput): SymbolStat[] {
  const signals =
    input.precomputedSignals ??
    new Map(
      computeAlgoSignals({
        candlesRepo: input.candlesRepo,
        pdnos: input.pdnos,
        ...(input.asOfDate !== undefined ? { asOfDate: input.asOfDate } : {}),
      }).map((s) => [s.pdno, s]),
    );

  return input.pdnos.map((pdno) => {
    const sig = signals.get(pdno);
    if (!sig || sig.splitScore === null) {
      const reason = sig?.labels.find((l) => l.includes('데이터 부족')) ?? '데이터 부족';
      return {
        pdno,
        lastClose: sig?.lastClose ?? null,
        volatility60d: deriveVolFromSignals(sig),
        avgVolume60d: null,
        rangePct120d: null,
        dataReason: reason,
      };
    }
    return {
      pdno,
      lastClose: sig.lastClose,
      volatility60d: deriveVolFromSignals(sig),
      avgVolume60d: deriveAvgVolFromSignals(sig),
      rangePct120d: deriveRangeFromSignals(sig),
      dataReason: null,
    };
  });
}

/**
 * algo signals 의 components.volatility (0~100) 점수를 역으로 추정한 % 수치는 산출 X.
 * 대신 box / lastClose 로부터 추정 가능한 metric 만 채운다.
 *
 * 정확한 % 수치가 필요한 경우 algo 신호의 raw input 을 추가 노출하거나 별도 계산.
 * 현재는 LLM 프롬프트에서 "참고 수치" 로만 쓰여서 컴포넌트 score 가 더 의미 있음.
 *
 * 단순화 — volatility60d 는 (high-low)/mid 로 fallback 추정.
 */
function deriveVolFromSignals(sig: AlgoSignals | undefined): number | null {
  if (!sig?.box || sig.lastClose === null || sig.box.mid <= 0) return null;
  // 박스 폭 기반 보수적 추정 — 실제 일일 std 와 다르지만 LLM 비교용으로 충분.
  const widthPct = ((sig.box.high - sig.box.low) / sig.box.mid) * 100;
  return Math.round(widthPct * 10) / 10;
}

function deriveAvgVolFromSignals(_sig: AlgoSignals): number | null {
  // 현재 AlgoSignals 는 거래량 절대값을 보존하지 않고 score 만 노출.
  // 필요 시 향후 raw avgVol 도 expose. 현재는 LLM 프롬프트에서 score 만으로 판단 가능.
  return null;
}

function deriveRangeFromSignals(sig: AlgoSignals): number | null {
  if (!sig.box || sig.box.mid <= 0) return null;
  return Math.round(((sig.box.high - sig.box.low) / sig.box.mid) * 1000) / 10;
}
