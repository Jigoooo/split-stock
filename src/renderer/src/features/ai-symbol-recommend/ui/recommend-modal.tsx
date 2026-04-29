import { Z_INDEX } from '@renderer/shared/config';
import { useMediaQuery } from '@renderer/shared/lib/interaction';
import { AnimatedProgress, Button } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import {
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  RecommendationDiagnostics,
  RecommendationProgressState,
  RecommendationViewState,
  TierDistribution,
} from '../model/use-symbol-recommendations';
import { ExtraPdnoPicker } from './extra-pdno-picker';
import { RecommendCard, RecommendDetail } from './recommend-card';

const TIER_LABELS: Record<keyof TierDistribution, string> = {
  top: 'TOP',
  strong: 'STRONG',
  moderate: 'MODERATE',
  watch: 'WATCH',
  avoid: 'AVOID',
};

function DistributionChips({ distribution }: { distribution: TierDistribution }): ReactElement {
  const tiers: Array<keyof TierDistribution> = ['top', 'strong', 'moderate', 'watch', 'avoid'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
      {tiers
        .filter((t) => distribution[t] > 0)
        .map((t) => (
          <span
            key={t}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              padding: '0.1rem 0.55rem',
              borderRadius: '999px',
              fontSize: '0.9rem',
              fontWeight: 700,
              color: '#ffffff',
              backgroundColor: TIER_COLORS[t],
            }}
          >
            {TIER_LABELS[t]} {distribution[t]}
          </span>
        ))}
    </div>
  );
}

function formatRelative(ts: number): string {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (elapsedSec < 60) return `${elapsedSec}초 전`;
  const min = Math.floor(elapsedSec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest > 0 ? `${min}분 ${rest}초` : `${min}분`;
}

function LoadingProgress({ progress }: { progress: RecommendationProgressState }): ReactElement {
  return (
    <AnimatedProgress
      percent={progress.percent}
      label={progress.label}
      meta={`${Math.round(progress.percent)}% · ${formatElapsed(progress.elapsedMs)}`}
      detail={progress.detail}
      ariaLabel={progress.label}
    />
  );
}

function SegmentButton({
  active,
  disabled,
  children,
  onClick,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  children: string;
  onClick: () => void;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        minHeight: '2rem',
        padding: '0.25rem 0.65rem',
        border: '0',
        borderRadius: '0.45rem',
        background: active ? '#D97757' : 'transparent',
        color: active ? '#fff' : 'var(--fg-2)',
        fontSize: '0.95rem',
        fontWeight: active ? 800 : 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.58 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function DiscoveryStatus({
  diagnostics,
}: {
  diagnostics: RecommendationDiagnostics;
}): ReactElement | null {
  const discovery = diagnostics.discovery;
  if (!discovery.enabled) return null;
  const failed = diagnostics.sources
    .filter((source) => source.status === 'failed')
    .map((source) => source.source);
  const text =
    discovery.addedCount > 0
      ? `자동발굴 ${discovery.addedCount}개 반영 · seed ${discovery.seedCount} · universe ${discovery.universeCount}`
      : `자동발굴 제한 · ${formatDiscoveryReason(discovery.emptyReason)}`;
  return (
    <span
      className="muted"
      title={
        failed.length > 0
          ? `실패 source: ${failed.join(', ')}`
          : discovery.basisDate
            ? `KRX 기준일 ${discovery.basisDate}`
            : undefined
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.25rem 0.6rem',
        borderRadius: '999px',
        border: '0.1rem solid var(--border)',
        fontSize: '0.95rem',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
      {failed.length > 0 ? ` · ${failed.length}개 API 제한` : ''}
    </span>
  );
}

function formatDiscoveryReason(reason: string | null): string {
  switch (reason) {
    case 'krx_unavailable':
      return 'KRX 데이터 없음';
    case 'broker_unavailable_or_no_cache':
      return '일봉 수집 불가';
    case 'no_screen_pass':
      return '조건 통과 없음';
    case 'no_seed_after_liquidity_filter':
      return '유동성 후보 없음';
    case 'auto_discovery_failed':
      return '자동발굴 실패';
    default:
      return reason ?? '후보 없음';
  }
}

export interface RecommendModalProps {
  view: RecommendationViewState;
  onClose: () => void;
  onAnalyze: () => void;
  onPick: (pdno: string, name: string) => void;
  extras: ReadonlyArray<string>;
  onAddExtra: (pdno: string) => void;
  onRemoveExtra: (pdno: string) => void;
  aiOff: boolean;
  onToggleAiOff: (next: boolean) => void;
  includeAutoDiscovery: boolean;
  onToggleAutoDiscovery: (next: boolean) => void;
  hasDefaultKey: boolean;
}

const TIER_COLORS: Record<'top' | 'strong' | 'moderate' | 'watch' | 'avoid', string> = {
  top: '#D97757',
  strong: '#16a34a',
  moderate: '#94a3b8',
  watch: '#ca8a04',
  avoid: '#d4453a',
};

const OVERLAY_CLICK_DRAG_TOLERANCE_PX = 4;

export const RecommendModal = ({
  view,
  onClose,
  onAnalyze,
  onPick,
  extras,
  onAddExtra,
  onRemoveExtra,
  aiOff,
  onToggleAiOff,
  includeAutoDiscovery,
  onToggleAutoDiscovery,
  hasDefaultKey,
}: RecommendModalProps): ReactElement => {
  const isNarrow = useMediaQuery('(max-width: 860px)');
  const overlayPointerStartRef = useRef<{
    startedOnOverlay: boolean;
    x: number;
    y: number;
  } | null>(null);
  const distributionTotal =
    view.distribution.top +
    view.distribution.strong +
    view.distribution.moderate +
    view.distribution.watch +
    view.distribution.avoid;
  const pendingProgress = view.progress ?? {
    key: 'initial',
    percent: 8,
    label: '분석 준비 중',
    detail: '후보 종목을 확인하는 중입니다.',
    elapsedMs: 0,
  };
  const controlsDisabled = view.isPending;
  const allItems = useMemo(
    () => [...view.ranked, ...view.userInputResults],
    [view.ranked, view.userInputResults],
  );
  const hasResults = !view.isPending && !view.error && allItems.length > 0;
  const [selectedPdno, setSelectedPdno] = useState<string | null>(null);
  const selectedItem = allItems.find((item) => item.pdno === selectedPdno) ?? allItems[0] ?? null;

  useEffect(() => {
    if (allItems.length === 0) {
      setSelectedPdno(null);
      return;
    }
    setSelectedPdno((prev) =>
      prev && allItems.some((item) => item.pdno === prev) ? prev : (allItems[0]?.pdno ?? null),
    );
  }, [allItems]);

  const handleOverlayPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    overlayPointerStartRef.current = {
      startedOnOverlay: event.target === event.currentTarget,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const start = overlayPointerStartRef.current;
    overlayPointerStartRef.current = null;
    if (!start?.startedOnOverlay) return;

    const moved =
      Math.abs(event.clientX - start.x) > OVERLAY_CLICK_DRAG_TOLERANCE_PX ||
      Math.abs(event.clientY - start.y) > OVERLAY_CLICK_DRAG_TOLERANCE_PX;
    if (moved) return;

    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {view.isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: Z_INDEX.MODAL_BACKDROP,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.6rem',
          }}
          onPointerDown={handleOverlayPointerDown}
          onClick={handleOverlayClick}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: 'min(96rem, calc(100vw - 3.2rem))',
              maxWidth: 'calc(100vw - 3.2rem)',
              maxHeight: 'calc(100vh - 3.2rem)',
              height: hasResults ? 'min(72rem, calc(100vh - 3.2rem))' : undefined,
              overflow: 'hidden',
              backgroundColor: 'var(--bg)',
              border: '0.1rem solid var(--border)',
              borderRadius: '1.2rem',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
              padding: '1.6rem',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.8rem',
                marginBottom: '1.2rem',
                flex: '0 0 auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                }}
              >
                <Sparkles size={18} color="#D97757" />
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.6rem',
                    fontWeight: 700,
                    color: 'var(--fg)',
                  }}
                >
                  AI 추천
                </h2>
                {view.fromCache && view.lastFetchedAt !== null ? (
                  <span
                    className="muted"
                    title="LLM 비용 절감을 위해 10분 동안 결과를 캐시합니다. '다시 분석' 버튼으로 강제 재호출."
                    style={{
                      fontSize: '1rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '999px',
                      border: '0.1rem dashed var(--border)',
                    }}
                  >
                    캐시됨 · {formatRelative(view.lastFetchedAt)}
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Button
                  variant="ghost"
                  iconOnly
                  dense
                  iconLeading={<X size={14} />}
                  onClick={onClose}
                  aria-label="닫기"
                  title="닫기"
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.8rem',
                flexWrap: 'wrap',
                marginBottom: '1rem',
                padding: '0.65rem',
                border: '0.1rem solid var(--border)',
                borderRadius: '0.7rem',
                background: 'var(--bg-2, rgba(0,0,0,0.025))',
                flex: '0 0 auto',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}
              >
                <span className="muted" style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                  분석 범위
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    padding: '0.15rem',
                    borderRadius: '0.55rem',
                    border: '0.1rem solid var(--border)',
                    background: 'var(--bg)',
                  }}
                >
                  <SegmentButton
                    active={!includeAutoDiscovery}
                    disabled={controlsDisabled}
                    onClick={() => onToggleAutoDiscovery(false)}
                  >
                    보유/감시만
                  </SegmentButton>
                  <SegmentButton
                    active={includeAutoDiscovery}
                    disabled={controlsDisabled}
                    title="KOSPI/KOSDAQ 전체 후보에서 자동발굴 후보를 함께 선별"
                    onClick={() => onToggleAutoDiscovery(true)}
                  >
                    자동 발굴 포함
                  </SegmentButton>
                </span>
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}
              >
                <span className="muted" style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                  분석 방식
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    padding: '0.15rem',
                    borderRadius: '0.55rem',
                    border: '0.1rem solid var(--border)',
                    background: 'var(--bg)',
                  }}
                >
                  <SegmentButton
                    active={!aiOff}
                    disabled={controlsDisabled || !hasDefaultKey}
                    title={hasDefaultKey ? '알고리즘 + AI 근거 합성' : 'AI 키 미등록'}
                    onClick={() => onToggleAiOff(false)}
                  >
                    AI 분석
                  </SegmentButton>
                  <SegmentButton
                    active={aiOff || !hasDefaultKey}
                    disabled={controlsDisabled}
                    onClick={() => onToggleAiOff(true)}
                  >
                    알고리즘만
                  </SegmentButton>
                </span>
              </div>
              <DiscoveryStatus diagnostics={view.diagnostics} />
            </div>

            <div style={{ marginBottom: '1.2rem', flex: '0 0 auto' }}>
              <ExtraPdnoPicker
                extras={extras}
                onAdd={onAddExtra}
                onRemove={onRemoveExtra}
                disabled={controlsDisabled}
                max={10}
              />
            </div>

            {view.isPending ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '4rem 1rem',
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                  style={{ display: 'inline-flex' }}
                >
                  <Sparkles size={32} color="#D97757" />
                </motion.div>
                <div className="muted" style={{ fontSize: '1.2rem' }}>
                  후보군과 외부 컨텍스트를 분석 중...
                </div>
                <LoadingProgress progress={pendingProgress} />
              </div>
            ) : view.error ? (
              <div
                style={{
                  display: 'grid',
                  justifyItems: 'center',
                  gap: '1rem',
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--down, #d4453a)',
                  fontSize: '1.2rem',
                }}
              >
                <div>{view.error}</div>
                <Button
                  variant="primary"
                  iconLeading={<RefreshCw size={14} />}
                  onClick={onAnalyze}
                  style={{
                    backgroundColor: '#D97757',
                    borderColor: '#D97757',
                    minWidth: '12rem',
                  }}
                >
                  재시도
                </Button>
              </div>
            ) : view.emptyReason && allItems.length === 0 ? (
              <div
                style={{
                  display: 'grid',
                  justifyItems: 'center',
                  gap: '1rem',
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--fg-2)',
                  fontSize: '1.2rem',
                }}
              >
                <div>{view.emptyReason}</div>
                <Button
                  variant="primary"
                  iconLeading={<RefreshCw size={14} />}
                  onClick={onAnalyze}
                  style={{
                    backgroundColor: '#D97757',
                    borderColor: '#D97757',
                    minWidth: '12rem',
                  }}
                >
                  재시도
                </Button>
              </div>
            ) : allItems.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1.2rem',
                  padding: '4rem 1.5rem',
                  textAlign: 'center',
                }}
              >
                <Sparkles size={32} color="#D97757" />
                <div style={{ fontSize: '1.25rem', color: 'var(--fg)', lineHeight: 1.6 }}>
                  분석 범위와 방식을 설정한 뒤<br />
                  <strong>분석 시작</strong> 버튼을 눌러주세요.
                </div>
                <Button
                  variant="primary"
                  iconLeading={<Sparkles size={14} />}
                  onClick={onAnalyze}
                  style={{
                    backgroundColor: '#D97757',
                    borderColor: '#D97757',
                    minWidth: '12rem',
                  }}
                >
                  분석 시작
                </Button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isNarrow ? '1fr' : 'minmax(18rem, 22rem) minmax(0, 1fr)',
                  gridTemplateRows: isNarrow
                    ? 'minmax(0, 1fr) minmax(0, 1fr) auto'
                    : 'minmax(0, 1fr) auto',
                  gap: '1rem',
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    alignContent: 'start',
                    minHeight: 0,
                    overflowY: 'auto',
                    paddingRight: '0.25rem',
                    paddingBottom: '0.6rem',
                  }}
                >
                  <section style={{ display: 'grid', gap: '0.6rem' }}>
                    <header
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: 'var(--fg)',
                        }}
                      >
                        AI 추천 ({view.ranked.length})
                      </h3>
                      {distributionTotal > 0 ? (
                        <DistributionChips distribution={view.distribution} />
                      ) : null}
                    </header>
                    <div style={{ display: 'grid', gap: '0.8rem' }}>
                      {view.ranked.map((item) => (
                        <RecommendCard
                          key={item.pdno}
                          item={item}
                          onPick={onPick}
                          selected={selectedItem?.pdno === item.pdno}
                          onSelect={setSelectedPdno}
                        />
                      ))}
                    </div>
                  </section>

                  {view.userInputResults.length > 0 ? (
                    <section style={{ display: 'grid', gap: '0.6rem' }}>
                      <header
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '0.5rem',
                          paddingTop: '1rem',
                          borderTop: '0.1rem dashed var(--border)',
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: '1.25rem',
                            fontWeight: 700,
                            color: 'var(--fg)',
                          }}
                        >
                          내 종목 검증 ({view.userInputResults.length})
                        </h3>
                        <span className="muted" style={{ fontSize: '0.95rem' }}>
                          직접 추가한 종목의 별도 평가 — 추천과 분리
                        </span>
                      </header>
                      <div style={{ display: 'grid', gap: '0.8rem' }}>
                        {view.userInputResults.map((item) => (
                          <RecommendCard
                            key={`user-${item.pdno}`}
                            item={item}
                            onPick={onPick}
                            selected={selectedItem?.pdno === item.pdno}
                            onSelect={setSelectedPdno}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {view.rejectedCount > 0 ? (
                    <div className="muted" style={{ fontSize: '1rem' }}>
                      AI 응답 중 {view.rejectedCount}건은 후보 풀 외 종목이라 제외됨.
                    </div>
                  ) : null}
                </div>
                <section
                  style={{
                    minWidth: 0,
                    minHeight: 0,
                    overflowY: 'auto',
                    border: '0.1rem solid var(--border)',
                    borderRadius: '0.8rem',
                    background: 'var(--bg-2, rgba(0,0,0,0.02))',
                    padding: '1rem',
                    boxSizing: 'border-box',
                  }}
                >
                  {selectedItem ? <RecommendDetail item={selectedItem} onPick={onPick} /> : null}
                </section>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center' }}>
                  <Button
                    variant="primary"
                    iconLeading={<RefreshCw size={14} />}
                    disabled={view.isPending}
                    onClick={onAnalyze}
                    style={{
                      backgroundColor: '#D97757',
                      borderColor: '#D97757',
                      minWidth: '14rem',
                    }}
                  >
                    다시 분석
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
};
