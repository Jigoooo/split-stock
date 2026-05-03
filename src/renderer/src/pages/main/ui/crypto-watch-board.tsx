import { Button, Checkbox, type HtsTabItem, HtsTabs, TableGrid } from '@renderer/shared/ui';
import type {
  CryptoAutoEvent,
  CryptoAutoTradeHistoryItem,
  CryptoAutoWatch,
  CryptoAutoWatchEntryCondition,
  CryptoAutoWatchStatus,
} from '@shared/contracts';
import { type MouseEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../model/crypto-formatters';
import { CryptoAutoEventTable } from './crypto-auto-event-table';
import { WatchContextMenu, type WatchContextMenuState } from './watch-context-menu';

type CryptoWatchBoardTab = 'status' | 'events' | 'failed' | 'history';

const CRYPTO_WATCH_BOARD_TABS = [
  { id: 'status', label: '현황' },
  { id: 'events', label: '실행내역' },
  { id: 'failed', label: '실패' },
  { id: 'history', label: '히스토리' },
] as const satisfies ReadonlyArray<HtsTabItem<CryptoWatchBoardTab>>;

const watchStatusLabel = (status: CryptoAutoWatchStatus): string =>
  ({
    WATCHING: '감시중',
    PAUSED: '중지',
    EXECUTED: '실행됨',
    FAILED: '실패',
    CANCELLED: '삭제됨',
  })[status];

const watchConditionLabel = (condition: CryptoAutoWatchEntryCondition): string => {
  if (condition.type === 'price-above') return `${condition.price ?? '-'} 이상`;
  if (condition.type === 'price-below') return `${condition.price ?? '-'} 이하`;
  return '즉시';
};

export const CryptoWatchBoard = ({
  enabled,
  events,
  failedHistory,
  history,
  loading,
  onAdd,
  onDelete,
  onEdit,
  onPause,
  onResume,
  pending,
  watches,
}: {
  enabled: boolean;
  events: CryptoAutoEvent[];
  failedHistory: CryptoAutoTradeHistoryItem[];
  history: CryptoAutoTradeHistoryItem[];
  loading: boolean;
  onAdd: () => void;
  onDelete: (ids: number[]) => void;
  onEdit: (watch: CryptoAutoWatch) => void;
  onPause: (ids: number[]) => void;
  onResume: (ids: number[]) => void;
  pending: boolean;
  watches: CryptoAutoWatch[];
}): ReactElement => {
  const [tab, setTab] = useState<CryptoWatchBoardTab>('status');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<WatchContextMenuState | null>(null);
  const selected = Array.from(selectedIds);
  const clearMissingSelections = useMemo(
    () => new Set(watches.map((watch) => watch.id)),
    [watches],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => clearMissingSelections.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [clearMissingSelections]);
  useEffect(() => {
    if (!enabled) setMenu(null);
  }, [enabled]);

  const toggleAll = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(watches.map((watch) => watch.id)) : new Set());
  };
  const toggleOne = (id: number, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleByRow = (id: number): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const contextIdsFor = (id: number): number[] =>
    selectedIds.has(id) && selectedIds.size > 0 ? Array.from(selectedIds) : [id];
  const openContextMenu = (event: MouseEvent<HTMLDivElement>, watch: CryptoAutoWatch): void => {
    if (!enabled) return;
    event.preventDefault();
    const ids = contextIdsFor(watch.id);
    setMenu({
      ids,
      targetLabel: formatCryptoWatchMenuTarget(watches.filter((entry) => ids.includes(entry.id))),
      x: event.clientX,
      y: event.clientY,
    });
  };
  const clearAndRun = (run: (ids: number[]) => void, ids: number[]): void => {
    setMenu(null);
    setSelectedIds(new Set());
    run(ids);
  };
  const selectedWatches = watches.filter((watch) => selectedIds.has(watch.id));
  const menuWatches = menu ? watches.filter((watch) => menu.ids.includes(watch.id)) : [];
  const selectedAction = buildCryptoWatchActionState(selectedWatches, enabled);
  const menuAction = buildCryptoWatchActionState(menuWatches, enabled);
  const mutationDisabled = pending || !enabled;

  let content: ReactElement;
  if (tab === 'status') {
    content = (
      <div className="crypto-watch-board__table">
        <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동감시 현황">
          <TableGrid.Header>
            <TableGrid.Cell width="3.2rem">
              <Checkbox
                aria-label="코인 자동감시 전체 선택"
                checked={watches.length > 0 && selectedIds.size === watches.length}
                onChange={(event) => toggleAll(event.currentTarget.checked)}
                disabled={watches.length === 0}
              />
            </TableGrid.Cell>
            <TableGrid.Cell width="9rem">마켓</TableGrid.Cell>
            <TableGrid.Cell width="7rem">상태</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자동매수</TableGrid.Cell>
            <TableGrid.Cell width="7rem">자동매도</TableGrid.Cell>
            <TableGrid.Cell width="7rem" numeric>
              현재차수
            </TableGrid.Cell>
            <TableGrid.Cell width="8rem" numeric>
              진행중 주문
            </TableGrid.Cell>
            <TableGrid.Cell width="12rem">최초 조건</TableGrid.Cell>
            <TableGrid.Cell width="16rem">마지막 판단</TableGrid.Cell>
            <TableGrid.Cell width="16rem">차단 사유</TableGrid.Cell>
            <TableGrid.Cell width="10rem">최근 실행</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {watches.map((watch) => (
              <TableGrid.Row
                key={watch.id}
                selected={selectedIds.has(watch.id)}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('.hts-choice')) return;
                  toggleByRow(watch.id);
                }}
                onContextMenu={(event) => openContextMenu(event, watch)}
              >
                <TableGrid.Cell width="3.2rem">
                  <Checkbox
                    aria-label={`${watch.market} 선택`}
                    checked={selectedIds.has(watch.id)}
                    onChange={(event) => toggleOne(watch.id, event.currentTarget.checked)}
                    dense
                  />
                </TableGrid.Cell>
                <TableGrid.Cell width="9rem" className="num">
                  {watch.label ?? watch.market}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">{watchStatusLabel(watch.status)}</TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {watch.strategy.autoBuyEnabled ? 'ON' : 'OFF'}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem">
                  {watch.strategy.autoSellEnabled ? 'ON' : 'OFF'}
                </TableGrid.Cell>
                <TableGrid.Cell width="7rem" numeric>
                  {watch.currentStage}
                </TableGrid.Cell>
                <TableGrid.Cell width="8rem" numeric>
                  {watch.openOrderCount}
                </TableGrid.Cell>
                <TableGrid.Cell width="12rem">
                  {watchConditionLabel(watch.entryCondition)}
                </TableGrid.Cell>
                <TableGrid.Cell width="16rem">{watch.lastDecision ?? '-'}</TableGrid.Cell>
                <TableGrid.Cell width="16rem">
                  {watch.blockedReasons.length > 0 ? watch.blockedReasons.join(', ') : '-'}
                </TableGrid.Cell>
                <TableGrid.Cell width="10rem">{formatDateTime(watch.lastActionAt)}</TableGrid.Cell>
              </TableGrid.Row>
            ))}
            {watches.length === 0 ? (
              <TableGrid.Row placeholder>
                <TableGrid.Cell width="100%" className="muted">
                  {loading ? '코인 자동감시를 불러오는 중…' : '등록된 코인 자동감시가 없습니다.'}
                </TableGrid.Cell>
              </TableGrid.Row>
            ) : null}
          </TableGrid.Body>
        </TableGrid.Root>
      </div>
    );
  } else if (tab === 'events') {
    content = (
      <CryptoAutoEventTable events={events} emptyText="선택 마켓 자동감시 실행내역이 없습니다." />
    );
  } else if (tab === 'failed') {
    content = (
      <CryptoAutoTradeHistoryTable emptyText="실패 이력이 없습니다." history={failedHistory} />
    );
  } else {
    content = <CryptoAutoTradeHistoryTable emptyText="히스토리가 없습니다." history={history} />;
  }

  return (
    <section className="panel crypto-watch-board" aria-label="코인 자동감시 보드">
      <div className="watch-board__tabs">
        <HtsTabs<CryptoWatchBoardTab>
          tabs={CRYPTO_WATCH_BOARD_TABS}
          active={tab}
          onChange={setTab}
          ariaLabel="코인 자동감시 탭"
        />
        <Button dense variant="primary" onClick={onAdd} disabled={!enabled}>
          + 추가
        </Button>
      </div>
      {tab === 'status' ? (
        <div className="watch-list__bulk-bar" role="toolbar" aria-label="선택한 코인 자동감시 작업">
          <span className="muted">{selected.length}건 선택</span>
          <Button
            dense
            disabled={mutationDisabled || !selectedAction.canResume}
            onClick={() => clearAndRun(onResume, selected)}
          >
            시작
          </Button>
          <Button
            dense
            disabled={mutationDisabled || !selectedAction.canPause}
            onClick={() => clearAndRun(onPause, selected)}
          >
            중지
          </Button>
          <Button
            dense
            variant="destructive"
            disabled={mutationDisabled || !selectedAction.canDelete}
            onClick={() => clearAndRun(onDelete, selected)}
          >
            삭제
          </Button>
          <span className="muted watch-table-toolbar__hint">{selectedAction.helpText}</span>
        </div>
      ) : (
        <div className="watch-list__bulk-bar" role="toolbar" aria-label="코인 자동감시 탭 요약">
          <span className="muted">
            {CRYPTO_WATCH_BOARD_TABS.find((item) => item.id === tab)?.label}
          </span>
        </div>
      )}
      {!enabled ? (
        <div className="panel__body muted">Upbit 실전 계좌에서 자동감시 현황을 볼 수 있습니다.</div>
      ) : (
        content
      )}
      {menu ? (
        <WatchContextMenu
          allowEdit={menu.ids.length === 1}
          allowMutations={enabled}
          canDelete={menuAction.canDelete}
          canPause={menuAction.canPause}
          canResume={menuAction.canResume}
          helpText={menuAction.helpText}
          menu={menu}
          mutationPending={pending}
          onClose={() => setMenu(null)}
          onDelete={(ids) => clearAndRun(onDelete, ids)}
          onEdit={() => {
            const target = watches.find((watch) => watch.id === menu.ids[0]);
            setMenu(null);
            if (target) onEdit(target);
          }}
          onPause={(ids) => clearAndRun(onPause, ids)}
          onResume={(ids) => clearAndRun(onResume, ids)}
        />
      ) : null}
    </section>
  );
};

function formatCryptoWatchMenuTarget(watches: CryptoAutoWatch[]): string {
  const first = watches[0];
  if (!first) return '코인 자동감시';
  const label = first.label ?? first.market;
  return watches.length > 1 ? `${label} 외 ${watches.length - 1}건` : label;
}

function buildCryptoWatchActionState(
  watches: CryptoAutoWatch[],
  enabled: boolean,
): {
  canDelete: boolean;
  canPause: boolean;
  canResume: boolean;
  helpText: string;
} {
  if (!enabled) {
    return {
      canDelete: false,
      canPause: false,
      canResume: false,
      helpText: 'Upbit 실전 계좌에서만 변경할 수 있습니다.',
    };
  }
  if (watches.length === 0) {
    return {
      canDelete: false,
      canPause: false,
      canResume: false,
      helpText: '자동감시를 선택하세요.',
    };
  }
  const canPause = watches.some((watch) => watch.status === 'WATCHING');
  const canResume = watches.some((watch) => watch.status !== 'WATCHING');
  return {
    canDelete: true,
    canPause,
    canResume,
    helpText:
      canPause || canResume
        ? '행 클릭으로 선택하고 우클릭으로 작업합니다.'
        : '변경할 수 없는 상태입니다.',
  };
}

export const CryptoAutoTradeHistoryTable = ({
  emptyText,
  history,
}: {
  emptyText: string;
  history: CryptoAutoTradeHistoryItem[];
}): ReactElement => (
  <TableGrid.Root variant="hts" stickyHeader horizontalScroll aria-label="코인 자동매매 이력">
    <TableGrid.Header>
      <TableGrid.Cell width="10rem">마켓</TableGrid.Cell>
      <TableGrid.Cell width="8rem">상태</TableGrid.Cell>
      <TableGrid.Cell width="10rem">액션</TableGrid.Cell>
      <TableGrid.Cell width="20rem">사유</TableGrid.Cell>
      <TableGrid.Cell width="10rem">모드</TableGrid.Cell>
      <TableGrid.Cell width="12rem">시각</TableGrid.Cell>
    </TableGrid.Header>
    <TableGrid.Body>
      {history.map((item) => (
        <TableGrid.Row key={item.id}>
          <TableGrid.Cell width="10rem" className="num">
            {item.market}
          </TableGrid.Cell>
          <TableGrid.Cell width="8rem">{item.status}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{item.action}</TableGrid.Cell>
          <TableGrid.Cell width="20rem">{item.reason}</TableGrid.Cell>
          <TableGrid.Cell width="10rem">{item.mode}</TableGrid.Cell>
          <TableGrid.Cell width="12rem">{formatDateTime(item.createdAt)}</TableGrid.Cell>
        </TableGrid.Row>
      ))}
      {history.length === 0 ? (
        <TableGrid.Row placeholder>
          <TableGrid.Cell width="100%" className="muted">
            {emptyText}
          </TableGrid.Cell>
        </TableGrid.Row>
      ) : null}
    </TableGrid.Body>
  </TableGrid.Root>
);
