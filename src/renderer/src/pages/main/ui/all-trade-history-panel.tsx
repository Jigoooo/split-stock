import type { ReactElement } from 'react';
import { useAllTradeHistory } from '../model/use-all-trade-history';
import { AllTradeHistoryFilterBar } from './all-trade-history-filter-bar';
import { AllTradeHistorySummaryBar } from './all-trade-history-summary';
import { AllTradeHistoryTable } from './all-trade-history-table';

export interface AllTradeHistoryPanelProps {
  accountId: number;
}

export const AllTradeHistoryPanel = ({ accountId }: AllTradeHistoryPanelProps): ReactElement => {
  const { actions, data, filters, status } = useAllTradeHistory(accountId);

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
      aria-label="모든 매매 내역 패널"
    >
      <AllTradeHistoryFilterBar
        applyFilters={actions.applyFilters}
        dayOptions={filters.dayOptions}
        draft={filters.draft}
        isApplying={status.isApplying}
        setDay={actions.setDay}
        setMonth={actions.setMonth}
        setSearch={actions.setSearch}
        setYear={actions.setYear}
        yearOptions={filters.yearOptions}
      />

      {status.error ? (
        <div style={{ padding: '0.6rem 0.8rem 0' }}>
          <span className="chip chip--down">{status.error.message}</span>
        </div>
      ) : null}

      <AllTradeHistorySummaryBar summary={data.summary} />
      <AllTradeHistoryTable isPending={status.isPending} rows={data.rows} />
    </section>
  );
};
