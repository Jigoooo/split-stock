import { Button } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { RecommendationViewState } from '../model/use-symbol-recommendations';
import { ExtraPdnoPicker } from './extra-pdno-picker';
import { RecommendCard } from './recommend-card';

export interface RecommendModalProps {
  view: RecommendationViewState;
  onClose: () => void;
  onRefresh: () => void;
  onPick: (pdno: string, name: string) => void;
  extras: ReadonlyArray<string>;
  onAddExtra: (pdno: string) => void;
  onRemoveExtra: (pdno: string) => void;
}

export const RecommendModal = ({
  view,
  onClose,
  onRefresh,
  onPick,
  extras,
  onAddExtra,
  onRemoveExtra,
}: RecommendModalProps): ReactElement => {
  return (
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
                gap: '0.8rem',
                marginBottom: '1.2rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Button
                  variant="ghost"
                  iconOnly
                  dense
                  iconLeading={<RefreshCw size={14} />}
                  disabled={view.isPending}
                  onClick={onRefresh}
                  aria-label="다시 분석"
                  title="다시 분석"
                />
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
            ) : (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                {view.ranked.map((item) => (
                  <RecommendCard key={item.pdno} item={item} onPick={onPick} />
                ))}
                {view.rejectedCount > 0 ? (
                  <div className="muted" style={{ fontSize: '1rem', marginTop: '0.4rem' }}>
                    AI 응답 중 {view.rejectedCount}건은 후보 풀 외 종목이라 제외됨.
                  </div>
                ) : null}
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
