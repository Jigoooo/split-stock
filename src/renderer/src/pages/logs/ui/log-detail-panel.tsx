import { Button } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { LOG_DETAIL_PANEL_HEIGHT, levelClass } from '../config/log-table';
import type { LogPayloadView } from '../lib/log-payload';
import type { LogEntry } from '../model/use-log-tail';

interface LogDetailPanelProps {
  onCopyPayload: () => void;
  payload: LogPayloadView;
  selectedEntry: LogEntry | null;
  selectedSummary: string;
}

export const LogDetailPanel = ({
  onCopyPayload,
  payload,
  selectedEntry,
  selectedSummary,
}: LogDetailPanelProps): ReactElement => (
  <div
    className="panel__body"
    style={{
      borderTop: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.8rem',
      flexShrink: 0,
      minHeight: LOG_DETAIL_PANEL_HEIGHT,
    }}
  >
    <div
      style={{
        alignItems: 'center',
        display: 'grid',
        gap: '0.8rem',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        minHeight: '2.8rem',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: '0.5rem',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <span className="muted" style={{ flexShrink: 0 }}>
          선택 로그
        </span>
        {selectedEntry ? (
          <span className={levelClass(selectedEntry.level)}>{selectedEntry.level}</span>
        ) : null}
        <span
          style={{
            color: 'var(--fg-2)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedSummary}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button dense onClick={onCopyPayload} disabled={!selectedEntry?.payloadJson}>
          payload 복사
        </Button>
      </div>
    </div>

    <div
      style={{
        display: 'grid',
        flex: 1,
        gap: '0.8rem',
        gridTemplateColumns: 'minmax(0, 0.92fr) minmax(0, 1.08fr)',
        minHeight: 0,
      }}
    >
      <LogDetailCard label="message">{selectedEntry?.message ?? '-'}</LogDetailCard>
      <LogDetailCard label="payload" mono preformatted>
        {payload.pretty}
      </LogDetailCard>
    </div>
  </div>
);

function LogDetailCard(props: {
  children: string;
  label: string;
  mono?: boolean;
  preformatted?: boolean;
}): ReactElement {
  const { children, label, mono = false, preformatted = false } = props;

  return (
    <section
      style={{
        background:
          'linear-gradient(180deg, var(--bg, #fff) 0%, var(--bg-2, rgba(0,0,0,0.03)) 100%)',
        border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
        borderRadius: '0.55rem',
        boxShadow: 'inset 0 -0.1rem 0 var(--border, rgba(0,0,0,0.08))',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        minHeight: '14.6rem',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          background: 'var(--bg-3, rgba(0,0,0,0.04))',
          borderBottom: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
          color: 'var(--fg-2)',
          display: 'flex',
          fontSize: '1rem',
          minHeight: '2.8rem',
          padding: '0 0.9rem',
        }}
      >
        {label}
      </div>
      <div style={{ minHeight: 0, overflow: 'auto', padding: '0.9rem', position: 'relative' }}>
        <div
          style={{
            color: 'var(--fg)',
            fontFamily: mono ? 'var(--mono, monospace)' : 'inherit',
            fontSize: mono ? '1.02rem' : '1.05rem',
            lineHeight: 1.5,
            minHeight: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {preformatted ? (
            <pre style={{ margin: 0, whiteSpace: 'inherit' }}>{children}</pre>
          ) : (
            children
          )}
        </div>
      </div>
    </section>
  );
}
