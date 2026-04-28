import type { ReactElement, ReactNode } from 'react';

interface AddWatchOrderFormRowProps {
  children: ReactNode;
  error?: string | undefined;
  label: string;
}

export const AddWatchOrderFormRow = ({
  children,
  error,
  label,
}: AddWatchOrderFormRowProps): ReactElement => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '6rem minmax(0, 1fr)',
      gap: '0.7rem',
      alignItems: 'start',
    }}
  >
    <span className="muted" style={{ paddingTop: '0.35rem' }}>
      {label}
    </span>
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      {children}
      {error ? (
        <span className="chip chip--down" role="alert" style={{ width: 'fit-content' }}>
          {error}
        </span>
      ) : null}
    </div>
  </div>
);
