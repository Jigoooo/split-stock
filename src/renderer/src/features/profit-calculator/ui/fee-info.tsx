import type { ReactElement } from 'react';
import type { FeeRates } from '../model/profit-calculator-types';

interface FeeInfoProps extends FeeRates {
  active: boolean;
}

export const FeeInfo = ({
  active,
  buyFeeRate,
  sellFeeRate,
  taxRate,
}: FeeInfoProps): ReactElement => {
  const rows = [
    { label: '매수 수수료율', value: `${buyFeeRate.toFixed(3)}%` },
    { label: '매도 수수료율', value: `${sellFeeRate.toFixed(3)}%` },
    { label: '세금률', value: `${taxRate.toFixed(3)}%` },
  ];

  return (
    <section className="profit-calculator__fee-box" aria-label="비용 가정">
      <div className="profit-calculator__section-header">
        <div>
          <div className="profit-calculator__section-title">비용 가정</div>
          <div className="profit-calculator__section-desc">
            설정 화면의 실전 수수료율을 기준으로 표시합니다.
          </div>
        </div>
        <span className={active ? 'chip chip--live' : 'chip'}>{active ? '계산 반영' : '참고'}</span>
      </div>
      <dl className="profit-calculator__fee-list">
        {rows.map((row) => (
          <div key={row.label} className="profit-calculator__fee-row">
            <dt>{row.label}</dt>
            <dd className="num">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};
