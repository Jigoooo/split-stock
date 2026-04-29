import { motion } from 'framer-motion';
import type { ReactElement } from 'react';

export interface AnimatedProgressProps {
  percent: number;
  label: string;
  meta?: string;
  detail?: string;
  ariaLabel?: string;
  color?: string;
  maxWidth?: string;
}

export function AnimatedProgress({
  percent,
  label,
  meta,
  detail,
  ariaLabel,
  color = '#D97757',
  maxWidth = '34rem',
}: AnimatedProgressProps): ReactElement {
  const boundedPercent = Math.min(100, Math.max(0, percent));
  const roundedPercent = Math.round(boundedPercent);

  return (
    <div
      style={{
        width: '100%',
        maxWidth,
        display: 'grid',
        gap: '0.55rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.8rem',
        }}
      >
        <strong style={{ fontSize: '1.08rem', color: 'var(--fg)' }}>{label}</strong>
        <span className="muted" style={{ fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
          {meta ?? `${roundedPercent}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-label={ariaLabel ?? label}
        style={{
          width: '100%',
          height: '0.7rem',
          borderRadius: '999px',
          overflow: 'hidden',
          backgroundColor: 'var(--border)',
        }}
      >
        <motion.div
          initial={false}
          animate={{ width: `${boundedPercent}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{
            width: `${boundedPercent}%`,
            height: '100%',
            borderRadius: '999px',
            backgroundColor: color,
          }}
        />
      </div>
      {detail ? (
        <div className="muted" style={{ fontSize: '1rem', textAlign: 'center', lineHeight: 1.45 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}
