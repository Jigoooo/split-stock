import { Button, TableGrid } from '@renderer/shared/ui';
import type { StrategyProfile } from '@shared/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import { createPortal } from 'react-dom';

export interface StrategyPreviewModalProps {
  open: boolean;
  profile: StrategyProfile | null;
  reasoning: string;
  onApply: () => void;
  onDismiss: () => void;
}

/**
 * AI 추천 strategy 상세 미리보기 — 차수별 triggerDropPct/amountKrw/targetProfitPct 를
 * 표 형태로 노출. 사용자가 적용 전 충분히 검토할 수 있도록.
 */
export const StrategyPreviewModal = ({
  open,
  profile,
  reasoning,
  onApply,
  onDismiss,
}: StrategyPreviewModalProps): ReactElement => {
  return createPortal(
    <AnimatePresence>
      {open && profile ? (
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
          onClick={onDismiss}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{
              width: '52rem',
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
                  AI 추천 strategy 상세 ({profile.maxStages}차)
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
                  매수 트리거 (직전 대비)
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  매수 금액
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
                  익절률
                </TableGrid.Cell>
              </TableGrid.Header>
              <TableGrid.Body>
                {Array.from({ length: profile.maxStages }, (_, i) => {
                  const nth = i + 1;
                  const buy = profile.buyRules[i];
                  const sell = profile.sellRules[i];
                  return (
                    <TableGrid.Row key={nth}>
                      <TableGrid.Cell
                        width={70}
                        style={{ justifyContent: 'center', fontWeight: 700 }}
                      >
                        {nth}차
                      </TableGrid.Cell>
                      <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
                        {nth === 1 ? (
                          <span className="muted">수동 진입</span>
                        ) : buy && buy.triggerDropPct !== null ? (
                          <span style={{ color: 'var(--down)' }}>
                            -{(buy.triggerDropPct * 100).toFixed(2)}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableGrid.Cell>
                      <TableGrid.Cell flex={1} numeric>
                        {buy ? `${buy.amountKrw.toLocaleString()}원` : '—'}
                      </TableGrid.Cell>
                      <TableGrid.Cell flex={1} style={{ justifyContent: 'center' }}>
                        {sell ? (
                          <span style={{ color: 'var(--up)' }}>
                            +{(sell.targetProfitPct * 100).toFixed(2)}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableGrid.Cell>
                    </TableGrid.Row>
                  );
                })}
              </TableGrid.Body>
            </TableGrid.Root>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.6rem',
                marginTop: '1.6rem',
              }}
            >
              <Button variant="ghost" dense onClick={onDismiss}>
                취소
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
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
};
