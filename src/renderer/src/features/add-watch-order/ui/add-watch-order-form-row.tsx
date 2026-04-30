import type { ReactElement, ReactNode } from 'react';
import { formLabelStyle } from '../config/add-watch-order-section-options';

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
      gridTemplateColumns: '7rem minmax(0, 1fr)',
      gap: '0.85rem',
      alignItems: 'start',
      padding: '0.18rem 0',
    }}
  >
    <span style={formLabelStyle()}>{label}</span>
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
