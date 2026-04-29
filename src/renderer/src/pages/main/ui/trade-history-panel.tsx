import { RecommendStrategyButton } from '@renderer/features/ai-strategy-recommend';
import { StrategyForm, useEditStrategy } from '@renderer/features/edit-strategy';
import { SymbolMemoForm } from '@renderer/features/symbol-memo';
import {
  alertDialog,
  Button,
  DialogType,
  type HtsTabItem,
  HtsTabs,
  OverlayScrollbar,
  Select,
} from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import type { CSSProperties } from 'react';
import { type ReactElement, useMemo, useRef, useState } from 'react';
import { type TradeHistoryTabKey, useTradeHistoryTabs } from '../model/use-trade-history-tabs';
import { TradeHistoryList } from './trade-history-list';

export interface TradeHistoryPanelProps {
  accountId: number;
  /** 선택된 종목 — null 이면 자동매매 설정/종목메모 탭 비활성화. */
  pdno: string | null;
  onOpenStrategySettings?: (() => void) | undefined;
}

const ALL_TABS: ReadonlyArray<HtsTabItem<TradeHistoryTabKey>> = [
  { id: 'strategy', label: '자동매매 설정' },
  { id: 'all', label: '전체보기' },
  { id: 'open', label: '진행중' },
  { id: 'closed', label: '종료' },
  { id: 'memo', label: '종목메모' },
];
const STRATEGY_STICKY_ACTION_BAR_SCROLLBAR_OFFSET_PX = 52;

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
  const tabs = useMemo<ReadonlyArray<HtsTabItem<TradeHistoryTabKey>>>(
    () =>
      pdno === null
        ? ALL_TABS.map((t) =>
            t.id === 'strategy' || t.id === 'memo' ? { ...t, badge: '종목 선택' } : t,
          )
        : ALL_TABS,
    [pdno],
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
      aria-label="매매내역 패널"
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
        {(tab === 'all' || tab === 'open' || tab === 'closed') && (
          <TradeHistoryList
            accountId={accountId}
            pdno={pdno}
            status={tab === 'all' ? 'all' : tab === 'open' ? 'open' : 'closed'}
          />
        )}
        {tab === 'strategy' &&
          (pdno !== null ? (
            <StrategyTabBody pdno={pdno} onOpenStrategySettings={props.onOpenStrategySettings} />
          ) : (
            <EmptyHint message="좌측에서 종목을 선택하면 해당 종목의 자동매매 설정을 편집할 수 있습니다." />
          ))}
        {tab === 'memo' &&
          (pdno !== null ? (
            <MemoTabBody pdno={pdno} />
          ) : (
            <EmptyHint message="좌측에서 종목을 선택하면 해당 종목의 메모를 편집할 수 있습니다." />
          ))}
      </div>
    </section>
  );
};

interface StrategyTabBodyProps {
  pdno: string;
  onOpenStrategySettings?: (() => void) | undefined;
}

/**
 * 자동매매 설정 탭 — `key={pdno}` 로 form 을 재마운트해
 * StrategyForm 의 sub-hook(useStageGrid 등) 들이 새 initial 로 다시 시드되도록 한다.
 * (StrategyForm 주석 참고)
 */
const StrategyTabBody = ({ onOpenStrategySettings, pdno }: StrategyTabBodyProps): ReactElement => {
  const { active, clear, isPending, presets, save } = useEditStrategy(pdno);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [initialOverride, setInitialOverride] = useState<StrategyProfile | null>(null);
  const presetItems = presets.data?.presets ?? [];
  const selectedPreset = presetItems.find((preset) => preset.name === selectedTemplate) ?? null;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (active.isPending || presets.isPending) {
    return (
      <div className="muted" style={{ overflow: 'auto', padding: '0.8rem' }}>
        자동매매 설정 로드 중…
      </div>
    );
  }
  if (active.error || presets.error) {
    return (
      <div style={{ overflow: 'auto', padding: '0.8rem' }}>
        <span className="chip chip--down">{active.error?.message ?? presets.error?.message}</span>
      </div>
    );
  }

  const initial = initialOverride ?? active.data?.profile ?? null;
  const sourceLabel =
    active.data?.source === 'symbol'
      ? '종목별 설정'
      : active.data?.source === 'global'
        ? '기본값 적용 중'
        : '내장 기본값 적용 중';
  const openTemplateManagement = (): void => {
    try {
      window.localStorage.setItem('popout:settings:initialTab', 'strategy');
      window.localStorage.setItem('popout:settings:strategyTab', 'templates');
    } catch {
      // localStorage 차단 시 — 기본 탭 fallback.
    }
    onOpenStrategySettings?.();
  };

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 0,
        scrollbarWidth: 'none',
      }}
    >
      <OverlayScrollbar
        containerRef={scrollRef}
        orientation="vertical"
        alwaysVisible={true}
        offset={{ right: 2, bottom: STRATEGY_STICKY_ACTION_BAR_SCROLLBAR_OFFSET_PX }}
      />
      <div
        style={
          {
            '--form-sticky-action-bar-bleed-left': '0.8rem',
            '--form-sticky-action-bar-bleed-right': '1.6rem',
            '--form-sticky-action-bar-bleed-bottom': '0.8rem',
            padding: '0.8rem 1.6rem 0.8rem 0.8rem',
            display: 'grid',
            gap: '0.8rem',
          } as CSSProperties
        }
      >
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="chip">{sourceLabel}</span>
          {active.data?.hasOverride ? (
            <Button
              onClick={() => {
                void (async () => {
                  const confirmed = await alertDialog.confirm({
                    type: DialogType.WARNING,
                    title: '기본값 사용',
                    message:
                      '이 종목의 개별 자동매매 설정을 삭제하고 기본값으로 되돌립니다. 기존 개별 설정은 모두 사라집니다. 계속할까요?',
                    confirmText: '기본값으로',
                    cancelText: '취소',
                  });
                  if (!confirmed) return;
                  await clear();
                  setInitialOverride(null);
                })();
              }}
              disabled={isPending}
              dense
            >
              기본값 사용
            </Button>
          ) : null}
          <Select
            value={selectedTemplate}
            onChange={(event) => setSelectedTemplate(event.target.value)}
            aria-label="불러올 템플릿 선택"
            disabled={isPending || presetItems.length === 0}
            dense
            style={{ minWidth: '15rem' }}
          >
            <option value="">템플릿 선택</option>
            {presetItems.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => {
              if (selectedPreset) setInitialOverride(selectedPreset.profile);
            }}
            disabled={isPending || !selectedPreset}
            dense
          >
            템플릿 불러오기
          </Button>
          <Button
            onClick={openTemplateManagement}
            disabled={isPending || !onOpenStrategySettings}
            dense
          >
            템플릿 관리
          </Button>
          <RecommendStrategyButton
            pdno={pdno}
            dense
            onApply={(profile) => {
              setInitialOverride(profile);
            }}
          />
        </div>
        <StrategyForm
          key={`${pdno}:${JSON.stringify(initial ?? {})}`}
          initial={initial}
          disabled={isPending}
          chrome="content"
          submitLabel="종목 설정 저장"
          submitContextLabel="종목 설정"
          onSubmit={(profile) => {
            void save(profile);
            setInitialOverride(null);
          }}
        />
      </div>
    </div>
  );
};

const MemoTabBody = ({ pdno }: { pdno: string }): ReactElement => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={scrollRef}
      style={{
        overflow: 'auto',
        padding: '0.8rem',
        scrollbarWidth: 'none',
      }}
    >
      <OverlayScrollbar containerRef={scrollRef} orientation="vertical" alwaysVisible={true} />
      <SymbolMemoForm pdno={pdno} />
    </div>
  );
};

const EmptyHint = ({ message }: { message: string }): ReactElement => (
  <div className="muted" style={{ padding: '1rem', fontSize: '1.1rem' }}>
    {message}
  </div>
);
