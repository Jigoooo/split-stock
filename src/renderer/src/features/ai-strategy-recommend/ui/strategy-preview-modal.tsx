import { Z_INDEX } from '@renderer/shared/config';
import { useMediaQuery } from '@renderer/shared/lib/interaction';
import { AnimatedProgress, Button, TableGrid } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { type CSSProperties, type ReactElement, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface StrategyPreviewModalProps {
  open: boolean;
  profile: StrategyProfile | null;
  reasoning: string;
  stageRationales?: ReadonlyArray<{
    nth: number;
    rationale: string;
    evidenceRefs: ReadonlyArray<string>;
  }>;
  globalRisks?: ReadonlyArray<string>;
  evidenceRefs?: ReadonlyArray<{ id: string; kind: string; title: string; detail: string }>;
  analysisConfidence?: 'high' | 'med' | 'low';
  dataQuality?: 'blocked' | 'limited' | 'normal';
  dataQualityReason?: string | undefined;
  error?: string | null;
  isPending?: boolean;
  progress?: {
    percent: number;
    label: string;
    detail: string;
    elapsedMs: number;
  } | null;
  onApply: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
}

/**
 * AI 추천 strategy 상세 미리보기 — 차수별 triggerDropPct/amountKrw/targetProfitPct 를
 * 표 형태로 노출. 사용자가 적용 전 충분히 검토할 수 있도록.
 */
export const StrategyPreviewModal = ({
  open,
  profile,
  reasoning,
  stageRationales = [],
  globalRisks = [],
  evidenceRefs = [],
  analysisConfidence = 'low',
  dataQuality = 'blocked',
  dataQualityReason,
  error = null,
  isPending = false,
  progress = null,
  onApply,
  onDismiss,
  onRetry,
}: StrategyPreviewModalProps): ReactElement => {
  const shouldRender = open;
  const [selectedNth, setSelectedNth] = useState(1);
  const isNarrow = useMediaQuery('(max-width: 860px)');
  useEffect(() => {
    if (profile) setSelectedNth((prev) => (prev <= profile.maxStages ? prev : 1));
  }, [profile]);
  const title = isPending
    ? 'AI 추천 strategy 분석 중'
    : error
      ? 'AI 추천 strategy 실패'
      : profile
        ? `AI 추천 strategy 상세 (${profile.maxStages}차)`
        : 'AI 추천 strategy';
  const stages = profile
    ? Array.from({ length: profile.maxStages }, (_, index) => ({
        id: `stage-${index + 1}`,
        nth: index + 1,
      }))
    : [];

  return createPortal(
    <AnimatePresence>
      {shouldRender ? (
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
          onClick={onDismiss}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: 'min(92rem, calc(100vw - 3.2rem))',
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
                marginBottom: '1.2rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Sparkles size={18} color="#D97757" />
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--fg)' }}>
                  {title}
                </h2>
              </div>
              <Button
                variant="ghost"
                iconOnly
                dense
                iconLeading={<X size={14} />}
                onClick={onDismiss}
                aria-label="닫기"
                title="닫기"
              />
            </div>

            {isPending ? (
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
                  종목 통계와 공시 컨텍스트를 분석 중...
                </div>
                {progress ? (
                  <AnimatedProgress
                    percent={progress.percent}
                    label={progress.label}
                    meta={`${Math.round(progress.percent)}% · ${formatElapsed(progress.elapsedMs)}`}
                    detail={progress.detail}
                    ariaLabel={progress.label}
                  />
                ) : null}
              </div>
            ) : error ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--down, #d4453a)',
                  fontSize: '1.2rem',
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            ) : profile ? (
              <>
                <div
                  style={{
                    padding: '0.9rem 1.1rem',
                    marginBottom: '1.2rem',
                    borderRadius: '0.5rem',
                    border: '0.1rem solid #D97757',
                    backgroundColor: 'rgba(217, 119, 87, 0.08)',
                    fontSize: '1.15rem',
                    color: 'var(--fg)',
                    lineHeight: 1.6,
                  }}
                >
                  <span style={{ color: '#D97757', fontWeight: 700 }}>추천 근거</span> · {reasoning}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isNarrow ? '1fr' : 'minmax(14rem, 18rem) minmax(0, 1fr)',
                    gap: '1rem',
                  }}
                >
                  <div style={{ display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
                    {stages.map((stage) => {
                      const nth = stage.nth;
                      const buy = profile.buyRules[nth - 1];
                      const sell = profile.sellRules[nth - 1];
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => setSelectedNth(nth)}
                          style={{
                            textAlign: 'left',
                            border:
                              selectedNth === nth
                                ? '0.15rem solid #D97757'
                                : '0.1rem solid var(--border)',
                            borderRadius: '0.55rem',
                            background:
                              selectedNth === nth ? 'rgba(217, 119, 87, 0.08)' : 'var(--bg)',
                            padding: '0.7rem',
                            cursor: 'pointer',
                            color: 'var(--fg)',
                          }}
                        >
                          <strong>{nth}차</strong>
                          <div
                            className="muted"
                            style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}
                          >
                            {nth === 1
                              ? '수동 진입'
                              : buy?.triggerDropPct !== null && buy?.triggerDropPct !== undefined
                                ? `-${(buy.triggerDropPct * 100).toFixed(2)}%`
                                : '트리거 —'}
                            {' · '}
                            {sell ? `+${(sell.targetProfitPct * 100).toFixed(2)}%` : '익절 —'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ minWidth: 0, display: 'grid', gap: '1rem' }}>
                    <StageDetail
                      nth={selectedNth}
                      profile={profile}
                      rationale={stageRationales.find((item) => item.nth === selectedNth)}
                      evidenceRefs={evidenceRefs}
                      globalRisks={globalRisks}
                      analysisConfidence={analysisConfidence}
                      dataQuality={dataQuality}
                      dataQualityReason={dataQualityReason}
                    />
                    <TableGrid.Root
                      variant="hts"
                      stickyHeader={false}
                      overlayScrollbar={false}
                      aria-label="차수별 매매 계획"
                      style={{ height: 'auto', '--hts-row-height': '3rem' } as CSSProperties}
                    >
                      <TableGrid.Header>
                        <TableGrid.Cell width={70} style={{ justifyContent: 'center' }}>
                          차수
                        </TableGrid.Cell>
                        <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
                          매수 트리거
                        </TableGrid.Cell>
                        <TableGrid.Cell flex={1} numeric>
                          매수 금액
                        </TableGrid.Cell>
                        <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
                          익절률
                        </TableGrid.Cell>
                      </TableGrid.Header>
                      <TableGrid.Body>
                        {stages.map((stage) => (
                          <StageRow key={stage.id} nth={stage.nth} profile={profile} />
                        ))}
                      </TableGrid.Body>
                    </TableGrid.Root>
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '3.2rem 1rem',
                  textAlign: 'center',
                }}
              >
                <Sparkles size={32} color="#D97757" />
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fg)' }}>
                  차수 분석을 시작할 준비가 되었습니다.
                </div>
                <div className="muted" style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>
                  종목 통계, 뉴스, 공시, 시장 컨텍스트를 새로 수집해 추천안을 만듭니다.
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.6rem',
                marginTop: '1.6rem',
              }}
            >
              {error ? (
                <>
                  <Button variant="ghost" dense onClick={onDismiss}>
                    닫기
                  </Button>
                  <Button
                    variant="primary"
                    dense
                    iconLeading={<RefreshCw size={14} />}
                    onClick={onRetry}
                    style={{
                      backgroundColor: '#D97757',
                      borderColor: '#D97757',
                      minWidth: '7rem',
                    }}
                  >
                    재시도
                  </Button>
                </>
              ) : isPending ? (
                <Button variant="ghost" dense onClick={onDismiss}>
                  닫기
                </Button>
              ) : profile ? (
                <>
                  <Button variant="ghost" dense onClick={onDismiss}>
                    취소
                  </Button>
                  <Button
                    variant="ghost"
                    dense
                    iconLeading={<RefreshCw size={14} />}
                    onClick={onRetry}
                    style={{
                      color: '#D97757',
                      borderColor: '#D97757',
                      minWidth: '7rem',
                    }}
                  >
                    다시 분석
                  </Button>
                  <Button
                    variant="primary"
                    dense
                    onClick={onApply}
                    style={{
                      backgroundColor: '#D97757',
                      borderColor: '#D97757',
                      minWidth: '7rem',
                    }}
                  >
                    폼에 적용
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" dense onClick={onDismiss}>
                    취소
                  </Button>
                  <Button
                    variant="primary"
                    dense
                    iconLeading={<Sparkles size={14} />}
                    onClick={onRetry}
                    style={{
                      backgroundColor: '#D97757',
                      borderColor: '#D97757',
                      minWidth: '8rem',
                    }}
                  >
                    분석 시작
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
};

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest > 0 ? `${min}분 ${rest}초` : `${min}분`;
}

function StageRow({ nth, profile }: { nth: number; profile: StrategyProfile }): ReactElement {
  const buy = profile.buyRules[nth - 1];
  const sell = profile.sellRules[nth - 1];
  return (
    <TableGrid.Row>
      <TableGrid.Cell width={70} style={{ justifyContent: 'center', fontWeight: 700 }}>
        {nth}차
      </TableGrid.Cell>
      <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
        {nth === 1 ? (
          <span className="muted">수동 진입</span>
        ) : buy && buy.triggerDropPct !== null ? (
          <span style={{ color: 'var(--down)' }}>-{(buy.triggerDropPct * 100).toFixed(2)}%</span>
        ) : (
          '—'
        )}
      </TableGrid.Cell>
      <TableGrid.Cell flex={1} numeric>
        {buy ? `${buy.amountKrw.toLocaleString()}원` : '—'}
      </TableGrid.Cell>
      <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
        {sell ? (
          <span style={{ color: 'var(--up)' }}>+{(sell.targetProfitPct * 100).toFixed(2)}%</span>
        ) : (
          '—'
        )}
      </TableGrid.Cell>
    </TableGrid.Row>
  );
}

function StageDetail({
  nth,
  profile,
  rationale,
  evidenceRefs,
  globalRisks,
  analysisConfidence,
  dataQuality,
  dataQualityReason,
}: {
  nth: number;
  profile: StrategyProfile;
  rationale: { nth: number; rationale: string; evidenceRefs: ReadonlyArray<string> } | undefined;
  evidenceRefs: ReadonlyArray<{ id: string; kind: string; title: string; detail: string }>;
  globalRisks: ReadonlyArray<string>;
  analysisConfidence: 'high' | 'med' | 'low';
  dataQuality: 'blocked' | 'limited' | 'normal';
  dataQualityReason?: string | undefined;
}): ReactElement {
  const buy = profile.buyRules[nth - 1];
  const sell = profile.sellRules[nth - 1];
  const usedRefs =
    rationale && rationale.evidenceRefs.length > 0
      ? evidenceRefs.filter((ref) => rationale.evidenceRefs.includes(ref.id))
      : evidenceRefs.slice(0, 5);
  return (
    <section
      style={{
        border: '0.1rem solid var(--border)',
        borderRadius: '0.7rem',
        padding: '1rem',
        background: 'var(--bg-2, rgba(0,0,0,0.02))',
        display: 'grid',
        gap: '0.75rem',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
      >
        <h3 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--fg)' }}>{nth}차 분석</h3>
        <span className="chip">
          {dataQuality} · {analysisConfidence}
        </span>
      </div>
      <div className="muted" style={{ fontSize: '1rem' }}>
        {dataQualityReason ?? '데이터 품질 정보 없음'}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
          gap: '0.5rem',
        }}
      >
        <Metric
          label="트리거"
          value={
            nth === 1
              ? '수동 진입'
              : buy?.triggerDropPct
                ? `-${(buy.triggerDropPct * 100).toFixed(2)}%`
                : '—'
          }
        />
        <Metric label="매수 금액" value={buy ? `${buy.amountKrw.toLocaleString()}원` : '—'} />
        <Metric
          label="익절률"
          value={sell ? `+${(sell.targetProfitPct * 100).toFixed(2)}%` : '—'}
        />
      </div>
      <div style={{ fontSize: '1.08rem', lineHeight: 1.55, color: 'var(--fg)' }}>
        {rationale?.rationale ?? '차수별 세부 근거가 응답에 포함되지 않았습니다.'}
      </div>
      {usedRefs.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.25rem' }}>
          {usedRefs.map((ref) => (
            <li
              key={ref.id}
              style={{ fontSize: '0.98rem', color: 'var(--fg-2)', lineHeight: 1.45 }}
            >
              <strong>{ref.title}</strong> · {ref.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {globalRisks.length > 0 ? (
        <div style={{ fontSize: '0.98rem', color: 'var(--down)', lineHeight: 1.45 }}>
          리스크: {globalRisks.join(' / ')}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div
      style={{
        border: '0.1rem solid var(--border)',
        borderRadius: '0.45rem',
        padding: '0.5rem 0.65rem',
        background: 'var(--bg)',
      }}
    >
      <div className="muted" style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--fg)' }}>{value}</div>
    </div>
  );
}
