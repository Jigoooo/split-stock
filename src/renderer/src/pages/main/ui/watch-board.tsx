import {
  useWatchHistory,
  useWatchOrders,
  type WatchOrder,
  type WatchStatus,
  type WatchTabKey,
} from '@renderer/entities/watch-order';
import {
  type AddWatchOrderPrefillPayload,
  storeAddWatchOrderPrefill,
  type WatchOrderFormPrefill,
} from '@renderer/features/add-watch-order';
import { RecommendButton } from '@renderer/features/ai-symbol-recommend';
import { Button, type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useWatchTabs } from '../model/use-watch-tabs';
import { WatchHistoryList } from './watch-history-list';
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
 *
 * 추가/수정은 별도 BrowserWindow(팝아웃)로 열린다.
 * prefill 데이터는 localStorage 를 통해 핸드오프한다.
 */
export const WatchBoard = (props: WatchBoardProps): ReactElement => {
  const { accountId } = props;
  const { setTab, tab } = useWatchTabs();

  const status = tabToStatusFilter(tab);
  const watchFilter =
    tab === 'watching'
      ? { accountId }
      : status !== undefined
        ? { accountId, status }
        : { accountId };
  const query = useWatchOrders(watchFilter);
  const history = useWatchHistory();
  const visible = filterByTab(tab, query.orders);

  const openAddWatchOrderPopout = (prefill: WatchOrderFormPrefill | null): void => {
    const payload: AddWatchOrderPrefillPayload = { accountId, prefill };
    storeAddWatchOrderPrefill(payload);
    void window.appShell?.openPopout('add-watch-order');
  };

  const onEditOrder = (prefill: WatchOrderFormPrefill): void => {
    openAddWatchOrderPopout(prefill);
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          minHeight: '2.8rem',
          padding: '0.3rem 0',
          flexShrink: 0,
        }}
      >
        <HtsTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="자동감시 4탭" />
        <div
          style={{
            marginLeft: 'auto',
            marginRight: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          {tab === 'watching' && (
            <>
              <RecommendButton
                dense
                onPick={(pdno, pdName) => {
                  openAddWatchOrderPopout({ pdno, pdName });
                }}
              />
              <Button
                onClick={() => openAddWatchOrderPopout(null)}
                variant="primary"
                dense
                style={{ whiteSpace: 'nowrap' }}
              >
                + 추가
              </Button>
            </>
          )}
        </div>
      </div>
      {tab === 'history' ? (
        <WatchHistoryList
          items={history.items}
          isPending={history.isPending}
          error={history.error}
        />
      ) : (
        <WatchList
          orders={visible}
          isPending={query.isPending}
          error={query.error}
          allowMutations={tab === 'watching'}
          emptyMessage={tabEmptyMessage(tab)}
          onEditOrder={onEditOrder}
          summaryLabel={tabSummaryLabel(tab)}
        />
      )}
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
  switch (tab) {
    case 'watching':
      return orders.filter((o) => o.status === 'WATCHING' || o.status === 'PAUSED');
    case 'history':
      return [];
    default:
      return orders;
  }
}

function tabSummaryLabel(tab: WatchTabKey): string {
  switch (tab) {
    case 'watching':
      return '현황';
    case 'executed':
      return '실행내역';
    case 'failed':
      return '실패';
    case 'history':
      return '히스토리';
  }
}

function tabEmptyMessage(tab: WatchTabKey): string {
  switch (tab) {
    case 'watching':
      return '자동감시 종목이 없습니다. 상단 "+ 추가" 버튼으로 시작하세요.';
    case 'executed':
      return '실행된 자동감시가 없습니다.';
    case 'failed':
      return '실패한 자동감시가 없습니다.';
    case 'history':
      return '히스토리 없음';
  }
}
