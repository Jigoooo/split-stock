import type { ReactElement } from 'react';
import type { IndicatorReason } from '../model/use-symbol-recommendations';

export interface IndicatorReasonsListProps {
  reasons: ReadonlyArray<IndicatorReason>;
}

/**
 * 지표별 [이름·값·의미] 리스트 — LLM 의 자연어 합성을 줄이고 사실 그대로 표시.
 *
 * 카드 펼침 정보용. 사용자가 "왜 이 점수가 나왔지?" 를 직관적으로 받아들일 수 있도록
 * 알고리즘이 산출한 사실(BB position, RSI 값, Aroon up/down 등) 만 노출.
 */
export const IndicatorReasonsList = ({ reasons }: IndicatorReasonsListProps): ReactElement => {
  return (
    <div>
      <div
        style={{
          marginBottom: '0.4rem',
          color: 'var(--fg-2)',
          fontWeight: 700,
          fontSize: '1.05rem',
        }}
      >
        지표별 사유
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.3rem' }}>
        {reasons.map((r) => (
          <li
            key={`${r.indicator}-${r.value}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(7rem, max-content) minmax(4rem, max-content) 1fr',
              gap: '0.6rem',
              padding: '0.4rem 0.6rem',
              borderRadius: '0.35rem',
              border: '0.1rem solid var(--border)',
              background: 'var(--bg)',
              fontSize: '1rem',
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--fg)' }}>[{r.indicator}]</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--fg)' }}>{r.value}</span>
            <span style={{ color: 'var(--fg-2)', lineHeight: 1.5 }}>{r.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
