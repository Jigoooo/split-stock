import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { ReactElement } from 'react';

export interface ConsensusBarProps {
  /** 동의한 지표 개수 (BB/RSI/MFI/momentum/Stoch/CCI 등). */
  count: number;
  /** 알고리즘이 검출한 모순 신호 — 빈 배열이면 충돌 없음. */
  conflicts: ReadonlyArray<string>;
  /** LLM 이 호출한 도구 이름 — 빈 배열이면 추가 검증 미수행. */
  citedTools: ReadonlyArray<string>;
}

/**
 * 합의(consensus) 인디케이터 + 모순(conflicts) 박스 + 도구 호출 chip.
 *
 * 점수의 신뢰도를 시각화. 사용자가 "이 점수가 얼마나 견고한가?" 를 한눈에 판단.
 * - 7+ 동의: strong (초록)
 * - 5+ 동의: moderate (노랑)
 * - 3+ 동의: weak (회색)
 * - 그 미만: insufficient
 */
export const ConsensusBar = ({ count, conflicts, citedTools }: ConsensusBarProps): ReactElement => {
  const tier = getConsensusTier(count);
  return (
    <div style={{ display: 'grid', gap: '0.55rem' }}>
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.3rem',
            fontSize: '1.05rem',
            color: 'var(--fg-2)',
            fontWeight: 700,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ShieldCheck size={14} />
            지표 합의 ({count}개 동의 · {tier.label})
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            height: '0.6rem',
            borderRadius: '0.3rem',
            background: 'var(--bg-2, rgba(0,0,0,0.06))',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, (count / 7) * 100)}%`,
              height: '100%',
              background: tier.color,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>

      {citedTools.length > 0 ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}
          title="LLM 이 호출한 도구 — 추가 검증에 사용됨"
        >
          <span style={{ fontSize: '1rem', color: 'var(--fg-2)' }}>도구 검증:</span>
          {citedTools.map((t) => (
            <span
              key={t}
              className="chip chip--live"
              style={{ fontSize: '0.95rem', padding: '0.1rem 0.55rem' }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gap: '0.3rem',
            padding: '0.6rem 0.8rem',
            borderRadius: '0.4rem',
            border: '0.1rem solid #d4453a',
            background: 'rgba(212, 69, 58, 0.07)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: '#d4453a',
            }}
          >
            <AlertTriangle size={14} />
            지표 충돌 ({conflicts.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.2rem' }}>
            {conflicts.map((c) => (
              <li key={c} style={{ fontSize: '1rem', color: 'var(--fg)', lineHeight: 1.5 }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

function getConsensusTier(count: number): { label: string; color: string } {
  if (count >= 7) return { label: '강함', color: '#16a34a' };
  if (count >= 5) return { label: '중간', color: '#ca8a04' };
  if (count >= 3) return { label: '약함', color: '#94a3b8' };
  return { label: '부족', color: 'var(--fg-2)' };
}
