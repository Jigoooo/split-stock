import type { ReactElement } from 'react';
import type { LogPayloadPreview } from '../lib/log-payload';

export function PayloadSummary({ payload }: { payload: LogPayloadPreview }): ReactElement {
  if (payload.chips.length === 0) {
    return (
      <span className="muted" style={{ fontFamily: 'var(--mono, monospace)', fontSize: '1.05rem' }}>
        {payload.summary}
      </span>
    );
  }

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: '0.35rem',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {payload.chips.map((chip) => (
        <span
          key={chip.key}
          style={{
            background: 'var(--bg-3, rgba(0,0,0,0.06))',
            border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
            borderRadius: '999px',
            color: 'var(--fg-2)',
            display: 'inline-flex',
            fontFamily: 'var(--mono, monospace)',
            fontSize: '1rem',
            gap: '0.25rem',
            maxWidth: '18rem',
            minWidth: 0,
            overflow: 'hidden',
            padding: '0.08rem 0.5rem',
          }}
        >
          <strong style={{ flexShrink: 0 }}>{chip.key}</strong>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.value}</span>
        </span>
      ))}
      {payload.hiddenCount > 0 ? (
        <span className="muted" style={{ flexShrink: 0 }}>
          +{payload.hiddenCount}
        </span>
      ) : null}
    </div>
  );
}
