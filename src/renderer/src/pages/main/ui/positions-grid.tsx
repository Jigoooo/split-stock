import {
  type BalanceStageCellMode,
  useGetDisplaySettings,
  useUpdateDisplaySettings,
} from '@renderer/entities/display-settings';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Select } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { usePositionsGrid } from '../model/use-positions-grid';
import { useSyncCurrentState } from '../model/use-sync-current-state';
import { PositionsMismatchPanel } from './positions-mismatch-panel';
import { PositionsSummary } from './positions-summary';
import { PositionsTable } from './positions-table';

const STAGE_CELL_MODE_OPTIONS = [
  { value: 'PERCENT', label: '수익률' },
  { value: 'DATE', label: '날짜' },
  { value: 'QTY', label: '수량' },
] as const satisfies ReadonlyArray<{ value: BalanceStageCellMode; label: string }>;

export interface PositionsGridProps {
  /** 활성 계좌 ID — Wave 4 cutover 시 props 로 주입. 본 wave 는 entity hook 의 active 계좌 사용. */
  accountId: number;
  selectedPdno?: string | null;
  onSelect?: (pdno: string) => void;
}

export const PositionsGrid = (props: PositionsGridProps): ReactElement => {
  const { accountId, onSelect, selectedPdno = null } = props;
  const { error, gridMaxStages, isPending, mismatches, rows, summary, syncStatus } =
    usePositionsGrid();
  const displaySettings = useGetDisplaySettings();
  const updateDisplaySettings = useUpdateDisplaySettings();
  const syncCurrentState = useSyncCurrentState(accountId);
  const stageCellMode: BalanceStageCellMode =
    displaySettings.settings?.grid.stageCellMode ?? 'PERCENT';

  return (
    <section
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
      aria-label={`보유 종목 그리드 (계좌 ${accountId})`}
    >
      <div
        className="panel__title"
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap',
        }}
      >
        <span>보유 종목 ({thousandSeparator(rows.length)}건)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="muted" style={{ fontSize: '1rem' }}>
            차수 표시
          </span>
          <Select
            dense
            aria-label="차수 셀 표시 방식"
            value={stageCellMode}
            disabled={updateDisplaySettings.isPending}
            onChange={(event) => {
              void updateDisplaySettings.mutateAsync({
                grid: { stageCellMode: event.target.value as BalanceStageCellMode },
              });
            }}
            style={{ minWidth: '7rem' }}
          >
            {STAGE_CELL_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <PositionsSummary summary={summary} />

      {syncStatus === 'MISMATCH' ? (
        <PositionsMismatchPanel
          mismatches={mismatches}
          syncPending={syncCurrentState.isPending}
          onSync={() => void syncCurrentState.mutateAsync({ accountId })}
        />
      ) : null}

      <PositionsTable
        accountId={accountId}
        error={error}
        gridMaxStages={gridMaxStages}
        isPending={isPending}
        onSelect={onSelect}
        rows={rows}
        selectedPdno={selectedPdno}
        stageCellMode={stageCellMode}
        summary={summary}
      />
    </section>
  );
};
