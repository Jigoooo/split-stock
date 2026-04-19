import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface GridDensityFormProps {
  rowHeightPx: number;
  isSaving: boolean;
  onChange: (px: number) => void;
  onSave: () => void;
  onReset: () => void;
}

export const GridDensityForm = ({
  rowHeightPx,
  isSaving,
  onChange,
  onSave,
  onReset,
}: GridDensityFormProps): ReactElement => {
  return (
    <section aria-label="그리드 설정" style={{ display: 'grid', gap: '1rem' }}>
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        그리드 행 높이
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label htmlFor="grid-row-height" style={{ fontSize: '1.2rem', whiteSpace: 'nowrap' }}>
          행 높이 (px)
        </label>
        <input
          id="grid-row-height"
          type="number"
          className="hts-input hts-input--dense hts-input--num"
          min={18}
          max={60}
          value={rowHeightPx}
          disabled={isSaving}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (Number.isFinite(val) && val >= 18 && val <= 60) {
              onChange(val);
            }
          }}
          aria-label="그리드 행 높이 px"
          style={{ width: '6rem' }}
        />
        <span className="muted" style={{ fontSize: '1rem' }}>
          18~60px
        </span>
      </div>

      {/* 미리보기 */}
      <div>
        <div className="muted" style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>
          미리보기
        </div>
        <table
          className="hts-table"
          style={{ '--hts-row-height': `${rowHeightPx}px` } as React.CSSProperties}
        >
          <thead>
            <tr>
              <th>종목명</th>
              <th className="num">현재가</th>
              <th className="num">등락률</th>
              <th className="num">보유수량</th>
            </tr>
          </thead>
          <tbody>
            {(['삼성전자', 'SK하이닉스', 'NAVER'] as const).map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">75,000</td>
                <td className="num" style={{ color: 'var(--up)' }}>
                  +1.23%
                </td>
                <td className="num">100</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
        <Button
          onClick={onReset}
          disabled={isSaving}
          variant="default"
          dense
          aria-label="그리드 설정 초기화"
        >
          초기화
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving}
          variant="primary"
          dense
          aria-label="그리드 설정 저장"
        >
          저장
        </Button>
      </div>
    </section>
  );
};
