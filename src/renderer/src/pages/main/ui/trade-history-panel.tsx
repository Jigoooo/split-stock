import { StrategyForm, useEditStrategy } from '@renderer/features/edit-strategy';
import { SymbolMemoForm } from '@renderer/features/symbol-memo';
import { type HtsTabItem, HtsTabs } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { type TradeHistoryTabKey, useTradeHistoryTabs } from '../model/use-trade-history-tabs';
import { TradeHistoryList } from './trade-history-list';

export interface TradeHistoryPanelProps {
  accountId: number;
  /** 선택된 종목 — null 이면 자동매매 설정/종목메모 탭 비활성화. */
  pdno: string | null;
}

const ALL_TABS: ReadonlyArray<HtsTabItem<TradeHistoryTabKey>> = [
  { id: 'all', label: '전체보기' },
  { id: 'open', label: '진행중' },
  { id: 'closed', label: '종료' },
  { id: 'strategy', label: '자동매매 설정' },
  { id: 'memo', label: '종목메모' },
];

/**
 * 우측 매매내역 패널 — R2 5탭.
 *
 * 탭별 내용:
 *  - all/open/closed : TradeHistoryList (status 필터)
 *  - strategy        : pdno 필요. features/edit-strategy 의 StrategyForm 마운트
 *  - memo            : pdno 필요. features/symbol-memo 의 SymbolMemoForm 마운트
 *
 * pdno 가 null 이면 strategy/memo 탭은 비활성화 (탭 자체는 노출 — 라벨에 안내).
 */
export const TradeHistoryPanel = (props: TradeHistoryPanelProps): ReactElement => {
  const { accountId, pdno } = props;
  const { setTab, tab } = useTradeHistoryTabs();

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
      aria-label="매매내역 패널"
    >
      <HtsTabs tabs={ALL_TABS} active={tab} onChange={setTab} ariaLabel="매매내역 5탭" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {(tab === 'all' || tab === 'open' || tab === 'closed') && (
          <TradeHistoryList
            accountId={accountId}
            pdno={pdno}
            status={tab === 'all' ? 'all' : tab === 'open' ? 'open' : 'closed'}
          />
        )}
        {tab === 'strategy' &&
          (pdno !== null ? (
            <StrategyTabBody pdno={pdno} />
          ) : (
            <EmptyHint message="좌측에서 종목을 선택하면 해당 종목의 자동매매 설정을 편집할 수 있습니다." />
          ))}
        {tab === 'memo' &&
          (pdno !== null ? (
            <div style={{ overflow: 'auto' }}>
              <SymbolMemoForm pdno={pdno} />
            </div>
          ) : (
            <EmptyHint message="좌측에서 종목을 선택하면 해당 종목의 메모를 편집할 수 있습니다." />
          ))}
      </div>
    </section>
  );
};

interface StrategyTabBodyProps {
  pdno: string;
}

/**
 * 자동매매 설정 탭 — `key={pdno}` 로 form 을 재마운트해
 * StrategyForm 의 sub-hook(useStageGrid 등) 들이 새 initial 로 다시 시드되도록 한다.
 * (StrategyForm 주석 참고)
 */
const StrategyTabBody = ({ pdno }: StrategyTabBodyProps): ReactElement => {
  const { active, isPending, save, saveAsPreset } = useEditStrategy(pdno);
  return (
    <div style={{ overflow: 'auto', padding: '0.6rem' }}>
      <StrategyForm
        key={pdno}
        initial={active.data?.profile ?? null}
        disabled={isPending || active.isPending}
        onSubmit={(profile) => {
          void save(profile);
        }}
        onSaveAsPreset={(name, profile) => {
          void saveAsPreset(name, profile);
        }}
      />
    </div>
  );
};

const EmptyHint = ({ message }: { message: string }): ReactElement => (
  <div className="muted" style={{ padding: '1rem', fontSize: '1.1rem' }}>
    {message}
  </div>
);
