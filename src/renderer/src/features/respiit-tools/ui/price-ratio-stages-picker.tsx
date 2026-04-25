import type { ReactElement } from 'react';

export interface StageOption {
  nth: number;
  buyPrice: number;
  qty: number;
}

interface Props {
  options: StageOption[];
  showAll: boolean;
  selected: 'all' | number[];
  onToggleAll: (next: boolean) => void;
  onChangeSelected: (next: number[]) => void;
}

/**
 * 차수 multi-select. 전체 토글 + 개별 차수 체크.
 */
export const PriceRatioStagesPicker = ({
  options,
  showAll,
  selected,
  onToggleAll,
  onChangeSelected,
}: Props): ReactElement | null => {
  if (options.length === 0) return null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span className="muted">적용 차수</span>
        <label
          style={{
            display: 'flex',
            gap: '0.3rem',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
          <span style={{ fontSize: '0.9rem' }}>전체</span>
        </label>
      </div>
      {!showAll && (
        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
          {options.map((stage) => (
            <label
              key={stage.nth}
              style={{
                display: 'flex',
                gap: '0.3rem',
                alignItems: 'center',
                cursor: 'pointer',
                padding: '0.3rem 0.5rem',
                borderRadius: '0.2rem',
                backgroundColor: 'var(--color-input-bg)',
              }}
            >
              <input
                type="checkbox"
                checked={selected !== 'all' && selected.includes(stage.nth)}
                onChange={(e) => {
                  if (selected === 'all') return;
                  const next = e.target.checked
                    ? [...selected, stage.nth].sort((a, b) => a - b)
                    : selected.filter((s) => s !== stage.nth);
                  onChangeSelected(next);
                }}
              />
              <span style={{ fontSize: '0.9rem' }}>
                {stage.nth}차 ({stage.qty.toLocaleString()}주 @{stage.buyPrice.toLocaleString()}원)
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
