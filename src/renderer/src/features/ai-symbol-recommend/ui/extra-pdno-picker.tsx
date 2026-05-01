import { SearchStockInput } from '@renderer/features/search-stock';
import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ExtraStock } from '../model/use-symbol-recommendations';

export interface ExtraPdnoPickerProps {
  extras: ReadonlyArray<ExtraStock>;
  onAdd: (stock: ExtraStock) => void;
  onRemove: (pdno: string) => void;
  disabled?: boolean;
  /** 최대 개수. 기본 10. */
  max?: number;
}

/**
 * AI 추천 모달 상단의 "관심 종목 추가" 검색기 — 보유/감시에 없는 종목을 풀에 합치기.
 * 사용자가 입력한 키워드로 stock_master 검색 → 클릭 시 extras 에 추가.
 * 추가된 항목은 chip 형태로 표시 + X 제거.
 */
export const ExtraPdnoPicker = ({
  extras,
  onAdd,
  onRemove,
  disabled = false,
  max = 10,
}: ExtraPdnoPickerProps): ReactElement => {
  const reachedMax = extras.length >= max;

  return (
    <div
      style={{
        border: '0.1rem solid var(--border)',
        borderRadius: '0.6rem',
        padding: '0.8rem',
        backgroundColor: 'var(--bg-2, rgba(0,0,0,0.02))',
        display: 'grid',
        gap: '0.6rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--fg)' }}>
          관심 종목 추가
        </span>
        <span className="muted" style={{ fontSize: '1rem' }}>
          {extras.length}/{max}
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <SearchStockInput
          limit={6}
          disabled={disabled || reachedMax}
          placeholder={
            reachedMax
              ? `최대 ${max}개까지 추가 가능합니다`
              : '종목명 또는 6자리 코드 입력 (예: 삼성전자, 005930)'
          }
          onSelect={(hit) => {
            onAdd({ pdno: hit.pdno, name: hit.name });
          }}
        />
      </div>

      {extras.length > 0 ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {extras.map((stock) => (
            <span
              key={stock.pdno}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.25rem 0.6rem',
                fontSize: '1.05rem',
                borderRadius: 'var(--radius-pill, 999rem)',
                border: '0.1rem solid #D97757',
                backgroundColor: 'rgba(217, 119, 87, 0.08)',
                color: '#D97757',
              }}
            >
              <span>{stock.name}</span>
              <span style={{ fontFamily: 'monospace', opacity: 0.82 }}>({stock.pdno})</span>
              <button
                type="button"
                aria-label={`${stock.name} ${stock.pdno} 제거`}
                onClick={() => onRemove(stock.pdno)}
                disabled={disabled}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: disabled ? 'default' : 'pointer',
                  padding: 0,
                  color: '#D97757',
                  display: 'inline-flex',
                  alignItems: 'center',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
