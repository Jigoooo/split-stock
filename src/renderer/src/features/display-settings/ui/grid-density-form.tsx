import { Button, NumberInput, TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

interface GridDensityFormProps {
  rowHeightPx: number;
  isDirty: boolean;
  isSaving: boolean;
  onChange: (px: number) => void;
  onSave: () => void;
  onReset: () => void;
}

export const GridDensityForm = ({
  rowHeightPx,
  isDirty,
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
        <span style={{ width: '8.5rem', display: 'inline-flex' }}>
          <NumberInput
            id="grid-row-height"
            dense
            showSpinner
            min={18}
            max={60}
            step={1}
            value={String(rowHeightPx)}
            disabled={isSaving}
            onValueChange={(raw) => {
              const next = Number(raw);
              if (Number.isFinite(next) && next >= 18 && next <= 60) {
                onChange(next);
              }
            }}
            aria-label="그리드 행 높이 px"
          />
        </span>
        <span className="muted" style={{ fontSize: '1rem' }}>
          18~60px
        </span>
      </div>

      {/* 미리보기 */}
      <div>
        <div className="muted" style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>
          미리보기
        </div>
        <TableGrid.Root
          variant="hts"
          stickyHeader={false}
          overlayScrollbar={false}
          style={{ height: 'auto', '--hts-row-height': `${rowHeightPx}px` } as React.CSSProperties}
        >
          <TableGrid.Header>
            <TableGrid.Cell flex={2}>종목명</TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              현재가
            </TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              등락률
            </TableGrid.Cell>
            <TableGrid.Cell flex={1} numeric>
              보유수량
            </TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {(['삼성전자', 'SK하이닉스', 'NAVER'] as const).map((name) => (
              <TableGrid.Row key={name}>
                <TableGrid.Cell flex={2}>{name}</TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  75,000
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric style={{ color: 'var(--up)' }}>
                  +1.23%
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  100
                </TableGrid.Cell>
              </TableGrid.Row>
            ))}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.6rem',
          minHeight: '2.4rem',
          alignItems: 'center',
        }}
      >
        <Button
          onClick={onReset}
          disabled={isSaving}
          variant="default"
          dense
          aria-label="그리드 설정 초기화"
          style={{ minWidth: '5.2rem' }}
        >
          초기화
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving || !isDirty}
          variant="primary"
          dense
          aria-label="그리드 설정 저장"
          style={{ minWidth: '5.2rem' }}
        >
          저장
        </Button>
      </div>
    </section>
  );
};
