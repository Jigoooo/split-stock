import { BackupPanel } from '@renderer/features/backup-restore';
import { CredentialsSettingsPanel } from '@renderer/features/credentials-settings';
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
import { SentrySettingsForm } from '@renderer/features/error-reporting';
import { ActivePendingList, PendingCancelForm } from '@renderer/features/pending-cancel-settings';
import { PriceCorrectionForm } from '@renderer/features/price-correction-settings';
import { ErrorBoundary, type HtsTabItem, HtsTabs, OverlayScrollbar } from '@renderer/shared/ui';
import type { ReactElement, ReactNode } from 'react';
import { useRef, useState } from 'react';

// 라벨 정의와 id 유니온을 한 곳에서 동기화 (single source of truth).
const TOP_TABS = [
  { id: 'strategy', label: '매매설정관리' },
  { id: 'display', label: '표시' },
  { id: 'orders', label: '주문/체결' },
  { id: 'account', label: '계좌/보안' },
  { id: 'monitoring', label: '관측' },
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

export const SettingsPage = (): ReactElement => {
  const [topTab, setTopTab] = useState<SettingsTopTab>(readInitialTab);
  const [strategyTab, setStrategyTab] = useState<StrategySettingsTab>('basic');
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
          <HtsTabs
            tabs={STRATEGY_SETTINGS_TABS}
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
          {topTab === 'strategy' ? (
            <Section name="매매설정관리">
              <StrategySection activeTab={strategyTab} onTabChange={setStrategyTab} />
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
          {topTab === 'monitoring' ? (
            <Section name="에러 보고 (Sentry)">
              <div className="panel">
                <div className="panel__title">에러 보고 (Sentry)</div>
                <div className="panel__body">
                  <SentrySettingsForm />
                </div>
              </div>
            </Section>
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
