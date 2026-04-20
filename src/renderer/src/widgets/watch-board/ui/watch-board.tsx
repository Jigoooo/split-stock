import {
  useWatchOrders,
  type WatchOrder,
  type WatchStatus,
  type WatchTabKey,
} from '@renderer/entities/watch-order';
import {
  AddWatchOrderDialog,
  useAddWatchOrderDialog,
  type WatchOrderFormPrefill,
} from '@renderer/features/add-watch-order';
import { Button } from '@renderer/shared/ui';
import { type HtsTabItem, HtsTabs } from '@renderer/widgets/hts-tabs';
import type { ReactElement } from 'react';
import { useWatchTabs } from '../model/use-watch-tabs';
import { WatchList } from './watch-list';

export interface WatchBoardProps {
  accountId: number;
}

const TABS: ReadonlyArray<HtsTabItem<WatchTabKey>> = [
  { id: 'watching', label: '현황' },
  { id: 'executed', label: '실행내역' },
  { id: 'failed', label: '실패' },
  { id: 'history', label: '히스토리' },
];

/**
 * 자동감시 4탭 보드 — 모든 탭은 entities/watch-order.useWatchOrders 의 status 필터로 조회.
 *
 * 'history' 탭은 EXPIRED + CANCELLED 만 표시 — useWatchOrders 는 단일 status 만 받으므로
 * 클라이언트 측에서 필터링한다.
 *
 * 우클릭 컨텍스트 메뉴 액션은 WATCHING(현황) 탭에서만 활성.
 * 현황 탭 헤더에 "+ 자동감시 추가" 버튼 노출.
 */
export const WatchBoard = (props: WatchBoardProps): ReactElement => {
  const { accountId } = props;
  const { setTab, tab } = useWatchTabs();
  const dialog = useAddWatchOrderDialog();

  const status = tabToStatusFilter(tab);
  const query = useWatchOrders(status !== undefined ? { accountId, status } : { accountId });
  const visible = filterByTab(tab, query.orders);

  const onEditOrder = (prefill: WatchOrderFormPrefill): void => {
    dialog.openEdit(prefill);
  };

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
      aria-label={`자동감시 보드 (계좌 ${accountId})`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <HtsTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="자동감시 4탭" />
        {tab === 'watching' && (
          <Button
            onClick={dialog.openCreate}
            variant="primary"
            dense
            style={{ marginLeft: 'auto', marginRight: '0.5rem', whiteSpace: 'nowrap' }}
          >
            + 추가
          </Button>
        )}
      </div>
      <WatchList
        orders={visible}
        isPending={query.isPending}
        error={query.error}
        allowMutations={tab === 'watching'}
        onEditOrder={onEditOrder}
      />
      <AddWatchOrderDialog
        open={dialog.open}
        accountId={accountId}
        prefill={dialog.prefill}
        onClose={dialog.close}
      />
    </section>
  );
};

/**
 * 탭별 서버 필터 status. 'history' 는 status 미지정 후 클라이언트 측 필터.
 */
function tabToStatusFilter(tab: WatchTabKey): WatchStatus | undefined {
  switch (tab) {
    case 'watching':
      return 'WATCHING';
    case 'executed':
      return 'EXECUTED';
    case 'failed':
      return 'FAILED';
    case 'history':
      return undefined;
  }
}

function filterByTab(tab: WatchTabKey, orders: WatchOrder[]): WatchOrder[] {
  if (tab !== 'history') return orders;
  return orders.filter((o) => o.status === 'EXPIRED' || o.status === 'CANCELLED');
}
