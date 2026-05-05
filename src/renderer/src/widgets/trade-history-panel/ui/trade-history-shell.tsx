import { type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import { type ReactElement, useMemo, useState, useTransition } from 'react';
import type {
  TradeHistoryShellProps,
  TradeHistoryShellTabKey,
} from '../model/trade-history-shell-types';

/**
 * Broker-agnostic 매매내역 패널 shell — stock/crypto 공유.
 *
 * 5탭 layout (자동매매 설정 / 전체보기 / 진행중 / 종료 / 메모) + section
 * 외곽 + 빈 상태 hint 가 100% 공유. broker 별 데이터/폼은 slot 으로 주입.
 *
 * 탭 변경은 useTransition 으로 deferred — 대용량 사이클 리스트 재렌더 중에도
 * 클릭 즉시 피드백 유지 (기존 useTradeHistoryTabs 동등).
 *
 * symbol === null 이면 strategy/memo 탭은 라벨에 "종목 선택" badge + slot 호출 X.
 */

const ALL_TABS: ReadonlyArray<HtsTabItem<TradeHistoryShellTabKey>> = [
  { id: 'strategy', label: '자동매매 설정' },
  { id: 'all', label: '전체보기' },
  { id: 'open', label: '진행중' },
  { id: 'closed', label: '종료' },
  { id: 'memo', label: '종목메모' },
];

const DEFAULT_STRATEGY_HINT =
  '좌측에서 종목을 선택하면 해당 종목의 자동매매 설정을 편집할 수 있습니다.';
const DEFAULT_MEMO_HINT = '좌측에서 종목을 선택하면 해당 종목의 메모를 편집할 수 있습니다.';

export const TradeHistoryShell = ({
  symbol,
  symbolHintText,
  ariaLabel = '매매내역 패널',
  initialTab = 'strategy',
  slots,
}: TradeHistoryShellProps): ReactElement => {
  const [tab, setTabRaw] = useState<TradeHistoryShellTabKey>(initialTab);
  const [, startTransition] = useTransition();
  const setTab = (next: TradeHistoryShellTabKey): void => {
    startTransition(() => setTabRaw(next));
  };

  const tabs = useMemo<ReadonlyArray<HtsTabItem<TradeHistoryShellTabKey>>>(
    () =>
      symbol === null
        ? ALL_TABS.map((t) =>
            t.id === 'strategy' || t.id === 'memo' ? { ...t, badge: '종목 선택' } : t,
          )
        : ALL_TABS,
    [symbol],
  );

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
      aria-label={ariaLabel}
    >
      <HtsTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="매매내역 5탭" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {(tab === 'all' || tab === 'open' || tab === 'closed') &&
          slots.historyPanel(tab === 'all' ? 'all' : tab === 'open' ? 'open' : 'closed', symbol)}
        {tab === 'strategy' &&
          (symbol !== null ? (
            slots.configPanel(symbol)
          ) : (
            <EmptyHint message={symbolHintText?.strategy ?? DEFAULT_STRATEGY_HINT} />
          ))}
        {tab === 'memo' &&
          (symbol !== null ? (
            slots.memoPanel(symbol)
          ) : (
            <EmptyHint message={symbolHintText?.memo ?? DEFAULT_MEMO_HINT} />
          ))}
      </div>
    </section>
  );
};

const EmptyHint = ({ message }: { message: string }): ReactElement => (
  <div className="muted" style={{ padding: '1rem', fontSize: '1.1rem' }}>
    {message}
  </div>
);
