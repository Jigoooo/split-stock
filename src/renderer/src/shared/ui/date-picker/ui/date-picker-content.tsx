import { Z_INDEX } from '@renderer/shared/config';
import { useMediaQuery } from '@renderer/shared/lib/interaction';
import { useColors } from '@renderer/shared/theme';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useDatePickerContext } from '../model/date-picker-context';
import type { DatePickerContentProps } from '../model/types';

export function DatePickerContent({ children, style }: DatePickerContentProps) {
  const colors = useColors();
  const isSheetMode = useMediaQuery('(max-width: 639px)');
  const { isOpen, setIsOpen, setFloating, floatingStyles, getFloatingProps, placement } =
    useDatePickerContext();

  if (isSheetMode) {
    return createPortal(
      <AnimatePresence>
        {isOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setIsOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: Z_INDEX.MODAL_BACKDROP,
                backgroundColor: colors.overlay.sheetBackdrop,
                backdropFilter: 'blur(2px)',
              }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: '100%', opacity: 0.88, scale: 0.985 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: '100%', opacity: 0.92, scale: 0.992 }}
              transition={{ type: 'spring', stiffness: 340, damping: 34, mass: 0.92 }}
              style={{
                position: 'fixed',
                insetInline: 0,
                bottom: 0,
                zIndex: Z_INDEX.MODAL,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                ref={setFloating}
                {...getFloatingProps()}
                style={{
                  width: '100%',
                  maxWidth: '48rem',
                  maxHeight: 'min(86dvh, 56rem)',
                  overflowY: 'auto',
                  padding: '1.2rem 1.2rem 1.6rem',
                  borderRadius: '2.8rem 2.8rem 0 0',
                  border: `1px solid ${colors.border.default}`,
                  background: `linear-gradient(180deg, ${colors.bg.elevated}, ${colors.bg.subtle})`,
                  boxShadow: `0 -24px 56px ${colors.shadow.modal}`,
                  pointerEvents: 'auto',
                  scrollbarWidth: 'none',
                  ...style,
                }}
              >
                <div
                  aria-hidden
                  style={{
                    width: '4.8rem',
                    height: '0.5rem',
                    borderRadius: 'var(--radius-pill, 999rem)',
                    backgroundColor: colors.border.default,
                    margin: '0 auto 1.2rem',
                  }}
                />
                {children}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>,
      document.body,
    );
  }

  if (!isOpen) return null;

  const opensAbove = placement.startsWith('top');

  return (
    <div
      ref={setFloating}
      style={{
        ...floatingStyles,
        marginTop: opensAbove ? 0 : '0.4rem',
        marginBottom: opensAbove ? '0.4rem' : 0,
        padding: '1rem',
        borderRadius: '1.4rem',
        border: `1px solid ${colors.border.default}`,
        background: `linear-gradient(180deg, ${colors.bg.elevated}, ${colors.bg.subtle})`,
        boxShadow: `0 28px 64px ${colors.shadow.modal}`,
        overflow: 'auto',
        zIndex: 40,
        ...style,
      }}
      {...getFloatingProps()}
    >
      {children}
    </div>
  );
}
