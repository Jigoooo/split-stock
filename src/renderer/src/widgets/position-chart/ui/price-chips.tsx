import { thousandSeparator } from '@renderer/shared/lib/formatter';
import type { ReactElement } from 'react';
import { usePriceSnapshot } from '../model/use-price-snapshot';

const formatKrw = (value: number): string => (value > 0 ? thousandSeparator(value) : '—');

function formatSigned(value: number): string {
  if (value === 0) return '0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(value, { allowNegative: true })}`;
}

/** 거래대금을 백만원/억원 단위로 축약 표기 (예: 12,345,678,901 → "123.5억"). */
function formatAccumValue(value: number): string {
  if (value <= 0) return '—';
  if (value >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(1)}억`;
  if (value >= 1_0000) return `${(value / 1_0000).toFixed(0)}만`;
  return thousandSeparator(value);
}

export const PriceChips = ({ pdno }: { pdno: string }): ReactElement => {
  const data = usePriceSnapshot(pdno);
  const changeClass =
    !data || data.dayChange === 0 ? 'num' : data.dayChange > 0 ? 'num-up' : 'num-down';
  const rateLabel = data
    ? `${data.dayChangeRate > 0 ? '+' : ''}${data.dayChangeRate.toFixed(2)}%`
    : '—';

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.8rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '1rem',
      }}
    >
      <span>
        <span className="muted">현재가</span>{' '}
        <span className={`num ${changeClass}`}>{data ? formatKrw(data.price) : '—'}</span>
      </span>
      <span>
        <span className="muted">전일대비</span>{' '}
        <span className={`num ${changeClass}`}>
          {data ? `${formatSigned(data.dayChange)} (${rateLabel})` : '—'}
        </span>
      </span>
      <span>
        <span className="muted">시</span>{' '}
        <span className="num">{data ? formatKrw(data.open) : '—'}</span>
      </span>
      <span>
        <span className="muted">고</span>{' '}
        <span className="num num-up">{data ? formatKrw(data.high) : '—'}</span>
      </span>
      <span>
        <span className="muted">저</span>{' '}
        <span className="num num-down">{data ? formatKrw(data.low) : '—'}</span>
      </span>
      <span>
        <span className="muted">거래대금</span>{' '}
        <span className="num">{data ? formatAccumValue(data.accumValue) : '—'}</span>
      </span>
      <span>
        <span className="muted">상한</span>{' '}
        <span className="num num-up">{data ? formatKrw(data.upperLimit) : '—'}</span>
      </span>
      <span>
        <span className="muted">하한</span>{' '}
        <span className="num num-down">{data ? formatKrw(data.lowerLimit) : '—'}</span>
      </span>
    </div>
  );
};
