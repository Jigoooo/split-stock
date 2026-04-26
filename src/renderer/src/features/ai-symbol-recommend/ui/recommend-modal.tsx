import { Button } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type {
  RecommendationViewState,
  TierDistribution,
} from '../model/use-symbol-recommendations';
import { ExtraPdnoPicker } from './extra-pdno-picker';
import { RecommendCard } from './recommend-card';

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
  const distributionTotal =
    view.distribution.top +
    view.distribution.strong +
    view.distribution.moderate +
    view.distribution.watch +
    view.distribution.avoid;
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
            zIndex: 1000,
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.6rem',
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: '68rem',
              maxWidth: 'calc(100vw - 3.2rem)',
              maxHeight: 'calc(100vh - 3.2rem)',
              overflowY: 'auto',
              backgroundColor: 'var(--bg)',
              border: '0.1rem solid var(--border)',
              borderRadius: '1.2rem',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
              padding: '2rem',
              boxSizing: 'border-box',
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
                <label
                  title="ON: 보유/감시/수동 + 매직스플릿 친화 자동 발굴 종목 합집합으로 분석&#10;OFF: 보유/감시/수동만"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.3rem 0.7rem',
                    borderRadius: '999px',
                    border: '0.1rem solid var(--border)',
                    fontSize: '1rem',
                    color: 'var(--fg-2)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeAutoDiscovery}
                    onChange={(e) => onToggleAutoDiscovery(e.currentTarget.checked)}
                    style={{ accentColor: '#D97757', margin: 0 }}
                  />
                  자동 발굴
                </label>
                <label
                  title={
                    hasDefaultKey
                      ? 'ON: 알고리즘 + LLM(공시/뉴스 컨텍스트)\nOFF: 알고리즘만 (LLM 호출 0회)'
                      : 'AI 키 미등록 — 알고리즘 전용으로만 동작합니다'
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.3rem 0.7rem',
                    borderRadius: '999px',
                    border: '0.1rem solid var(--border)',
                    fontSize: '1rem',
                    color: 'var(--fg-2)',
                    cursor: hasDefaultKey ? 'pointer' : 'not-allowed',
                    opacity: hasDefaultKey ? 1 : 0.7,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!aiOff}
                    disabled={!hasDefaultKey}
                    onChange={(e) => onToggleAiOff(!e.currentTarget.checked)}
                    style={{ accentColor: '#D97757', margin: 0 }}
                  />
                  AI 사용
                </label>
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

            <div style={{ marginBottom: '1.2rem' }}>
              <ExtraPdnoPicker
                extras={extras}
                onAdd={onAddExtra}
                onRemove={onRemoveExtra}
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
                  보유/감시 종목을 분석 중...
                </div>
              </div>
            ) : view.error ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--down, #d4453a)',
                  fontSize: '1.2rem',
                }}
              >
                {view.error}
              </div>
            ) : view.emptyReason && view.ranked.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--fg-2)',
                  fontSize: '1.2rem',
                }}
              >
                {view.emptyReason}
              </div>
            ) : view.ranked.length === 0 ? (
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
                  관심 종목 추가 / AI 사용 토글 등을 설정한 뒤<br />
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
              <div style={{ display: 'grid', gap: '1.4rem' }}>
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
                      <RecommendCard key={item.pdno} item={item} onPick={onPick} />
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
                        <RecommendCard key={`user-${item.pdno}`} item={item} onPick={onPick} />
                      ))}
                    </div>
                  </section>
                ) : null}

                {view.rejectedCount > 0 ? (
                  <div className="muted" style={{ fontSize: '1rem' }}>
                    AI 응답 중 {view.rejectedCount}건은 후보 풀 외 종목이라 제외됨.
                  </div>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    paddingTop: '1.4rem',
                    marginTop: '0.4rem',
                    borderTop: '0.1rem solid var(--border)',
                  }}
                >
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
                  <span className="muted" style={{ fontSize: '0.95rem' }}>
                    설정/관심 종목을 바꾼 뒤 새 결과를 받으려면 다시 분석을 누르세요.
                  </span>
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
