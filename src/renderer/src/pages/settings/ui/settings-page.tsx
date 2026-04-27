import { AiKeysSection, DartCorpCodeSection } from '@renderer/features/ai-settings';
import { BackupPanel } from '@renderer/features/backup-restore';
import {
  ChartSettingsForm,
  GridDensityForm,
  useDisplaySettings,
} from '@renderer/features/display-settings';
import {
  STRATEGY_SETTINGS_TABS,
  StrategySettingsSurface,
  type StrategySettingsTab,
} from '@renderer/features/edit-strategy';
// Sentry 관측 탭은 일시 숨김 — features/error-reporting 의 SentrySettingsForm 은 흔적으로 유지.
// import { SentrySettingsForm } from '@renderer/features/error-reporting';
import { FeeSettingsForm } from '@renderer/features/fee-settings';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { trpc } from '@renderer/shared/api/trpc';
import { ErrorBoundary, type HtsTabItem, HtsTabs, OverlayScrollbar } from '@renderer/shared/ui';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CredentialsSettingsPanel } from './credentials-settings-panel';

/**
 * 매매설정관리 서브탭 — features/edit-strategy 의 STRATEGY_SETTINGS_TABS 에
 * '수수료' 탭을 추가한 확장 배열. settings-page 자체에서 조립하여
 * features/edit-strategy 가 features/fee-settings 에 의존하지 않도록 한다.
 */
const STRATEGY_TABS_WITH_FEE = [
  ...STRATEGY_SETTINGS_TABS,
  { id: 'fee' as const, label: '수수료' },
] as const satisfies ReadonlyArray<HtsTabItem<string>>;
type ExtendedStrategyTab = StrategySettingsTab | 'fee';

// 라벨 정의와 id 유니온을 한 곳에서 동기화 (single source of truth).
// 'monitoring'(Sentry DSN) 탭은 사용자 facing 가치가 낮아 일시 숨김 — 향후 빌드 환경변수
// 방식으로 재활성화 시 다시 추가.
const TOP_TABS = [
  { id: 'strategy', label: '매매설정관리' },
  { id: 'display', label: '표시' },
  { id: 'orders', label: '주문/체결' },
  { id: 'account', label: '계좌/보안' },
  { id: 'ai', label: 'AI' },
  { id: 'backup', label: '백업' },
] as const satisfies ReadonlyArray<HtsTabItem<string>>;

type SettingsTopTab = (typeof TOP_TABS)[number]['id'];

/**
 * 설정 페이지.
 * - 기본 자동매매 설정 + 계좌 공통 보호 설정 포함.
 * - 각 섹션은 ErrorBoundary 로 격리해 한 폼이 throw 해도 다른 섹션은 계속 사용 가능하도록 한다 (흰화면 방지).
 */
function readInitialTab(): SettingsTopTab {
  // popout 진입 시 호출자가 localStorage 로 전달한 초기 탭을 1회 소비.
  // (예: 차트 위젯의 차트 설정 아이콘 → 표시 탭 자동 선택)
  try {
    const v = window.localStorage.getItem('popout:settings:initialTab');
    if (v) {
      window.localStorage.removeItem('popout:settings:initialTab');
      const matched = TOP_TABS.find((t) => t.id === v);
      if (matched) return matched.id;
    }
  } catch {
    // localStorage 차단 환경 — 기본값 fallback
  }
  return 'strategy';
}

function readInitialStrategyTab(): ExtendedStrategyTab {
  // 매매설정관리 sub-tab 초기값을 호출자 localStorage 에서 1회 소비.
  // (예: 메인 폼의 "템플릿 관리" 버튼 → 템플릿 sub-tab 자동 선택)
  try {
    const v = window.localStorage.getItem('popout:settings:strategyTab');
    if (v) {
      window.localStorage.removeItem('popout:settings:strategyTab');
      const matched = STRATEGY_TABS_WITH_FEE.find((t) => t.id === v);
      if (matched) return matched.id;
    }
  } catch {
    // localStorage 차단 환경 — 기본값 fallback
  }
  return 'basic';
}

export const SettingsPage = (): ReactElement => {
  const [topTab, setTopTab] = useState<SettingsTopTab>(readInitialTab);
  const [strategyTab, setStrategyTab] = useState<ExtendedStrategyTab>(readInitialStrategyTab);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 탭별 스크롤 위치 보존 — 사용자가 긴 패널을 읽다가 다른 탭 갔다 돌아왔을 때
  // 매번 최상단으로 리셋되는 문제(P2-Settings) 해결.
  // strategy 안의 sub-tab(strategyTab) 도 키에 포함해 세분화.
  const tabKey = topTab === 'strategy' ? `${topTab}:${strategyTab}` : topTab;
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevTabKeyRef = useRef<string>(tabKey);

  // 탭 전환 직전(=현재 탭의 마지막 위치)을 보관, 새 탭 마운트 후 저장된 위치 복원.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevTabKeyRef.current;
    if (prev !== tabKey) {
      scrollPositionsRef.current.set(prev, el.scrollTop);
      const restored = scrollPositionsRef.current.get(tabKey) ?? 0;
      el.scrollTop = restored;
      prevTabKeyRef.current = tabKey;
    }
  }, [tabKey]);

  // 사용자 스크롤 변경을 추적해 현재 탭 키에 즉시 기록 — 다음 탭 전환 시 정확한 복원 보장.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      scrollPositionsRef.current.set(tabKey, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, [tabKey]);

  return (
    // 탭은 상단 고정, 컨텐츠만 스크롤. height:100% + minHeight:0 패턴으로 컨테이너의 가용 높이를 채운다.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg-1, var(--bg))',
          paddingBottom: '0.6rem',
          display: 'grid',
          gap: '0.6rem',
        }}
      >
        <HtsTabs tabs={TOP_TABS} active={topTab} onChange={setTopTab} ariaLabel="설정 상위 탭" />
        {topTab === 'strategy' ? (
          <HtsTabs<ExtendedStrategyTab>
            tabs={STRATEGY_TABS_WITH_FEE}
            active={strategyTab}
            onChange={setStrategyTab}
            ariaLabel="기본 자동매매설정 탭"
          />
        ) : null}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: '0.4rem',
          // 네이티브 스크롤바 숨김 — OverlayScrollbar 가 시각화 담당
          scrollbarWidth: 'none',
        }}
        className="settings-scroll-area"
      >
        <OverlayScrollbar containerRef={scrollRef} orientation="vertical" alwaysVisible={true} />
        <div style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
          {topTab === 'strategy' && strategyTab === 'fee' ? (
            <Section name="수수료">
              <FeeSection />
            </Section>
          ) : null}
          {topTab === 'strategy' && strategyTab !== 'fee' ? (
            <Section name="매매설정관리">
              <StrategySection activeTab={strategyTab} onTabChange={(t) => setStrategyTab(t)} />
            </Section>
          ) : null}
          {topTab === 'display' ? (
            <Section name="표시 설정">
              <DisplaySettingsSection />
            </Section>
          ) : null}
          {topTab === 'orders' ? (
            <div style={{ display: 'grid', gap: '1.2rem' }}>
              <Section name="미체결 자동취소">
                <PendingCancelForm />
              </Section>
              <Section name="활성 미체결 목록">
                <ActivePendingList />
              </Section>
              <Section name="호가 자동 보정">
                <div className="panel">
                  <div className="panel__title">호가 자동 보정</div>
                  <div className="panel__body">
                    <PriceCorrectionForm />
                  </div>
                </div>
              </Section>
            </div>
          ) : null}
          {topTab === 'account' ? (
            <Section name="보안 · 자격증명">
              <CredentialsSettingsPanel />
            </Section>
          ) : null}
          {topTab === 'ai' ? (
            <div style={{ display: 'grid', gap: '1.2rem' }}>
              <Section name="AI 키 관리">
                <AiKeysSection />
              </Section>
              <Section name="DART 매핑">
                <DartCorpCodeSection />
              </Section>
            </div>
          ) : null}
          {topTab === 'backup' ? (
            <Section name="백업/복원">
              <BackupPanel />
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

function Section({ name, children }: { name: string; children: ReactNode }): ReactElement {
  return <ErrorBoundary name={name}>{children}</ErrorBoundary>;
}

/**
 * 기본 자동매매 설정 섹션.
 * - 전역 프리셋(pdno=null) 편집.
 * - presetKey 로 form 강제 재마운트 — sub-hook stale 방지 (검증된 패턴).
 */
function StrategySection({
  activeTab,
  onTabChange,
}: {
  activeTab: StrategySettingsTab;
  onTabChange: (tab: StrategySettingsTab) => void;
}): ReactElement {
  return (
    <div className="panel">
      <div className="panel__body">
        <StrategySettingsSurface activeTab={activeTab} onTabChange={onTabChange} hideTabs />
      </div>
    </div>
  );
}

/**
 * 수수료 / 제세금 설정 섹션. 현재 활성 환경의 수수료만 표시/수정.
 * 환경 전환 시 자동으로 새 환경 데이터 로드.
 */
function FeeSection(): ReactElement {
  const envQuery = trpc.auth.getEnv.useQuery();
  const env = envQuery.data?.env ?? null;
  if (envQuery.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">환경 확인 중…</div>
      </div>
    );
  }
  if (env === null) {
    return (
      <div className="panel">
        <div className="panel__body muted">활성 환경이 없습니다. 먼저 계좌를 활성화하세요.</div>
      </div>
    );
  }
  // FeeEnv: 'real' | 'mock'. AppEnv: 'PROD' | 'MOCK'. mapping.
  const feeEnv = env === 'PROD' ? 'real' : 'mock';
  return <FeeSettingsForm env={feeEnv} />;
}

function DisplaySettingsSection(): ReactElement {
  const display = useDisplaySettings();

  if (display.isPending) {
    return (
      <div className="panel">
        <div className="panel__body muted">표시 설정 로드 중…</div>
      </div>
    );
  }

  if (display.error) {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="chip chip--down">{display.error.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1.2rem' }}>
      <div className="panel">
        <div className="panel__title">차트 표시</div>
        <div className="panel__body">
          <ChartSettingsForm
            resolvedMa={display.resolvedMa}
            resolvedVolume={display.resolvedVolume}
            resolvedCrosshair={display.resolvedCrosshair}
            isSaving={display.isSaving}
            onMaChange={display.setMaField}
            onVolumeChange={(field, value) => {
              display.setVolumeField(
                field as 'upColor' | 'downColor' | 'heightPercent',
                value as never,
              );
            }}
            onCrosshairChange={(field, value) => {
              display.setCrosshairField(field as 'mode' | 'labelVisible', value as never);
            }}
            onSave={display.handleSave}
            onReset={display.handleReset}
          />
        </div>
      </div>
      <div className="panel">
        <div className="panel__title">그리드 표시</div>
        <div className="panel__body">
          <GridDensityForm
            rowHeightPx={display.resolvedRowHeight}
            isSaving={display.isSaving}
            onChange={display.setRowHeight}
            onSave={display.handleSave}
            onReset={display.handleReset}
          />
        </div>
      </div>
    </div>
  );
}
