import type { ReactElement } from 'react';

interface AddWatchOrderFormRowProps {
  children: ReactElement | ReactElement[];
  label: string;
}

export const AddWatchOrderFormRow = ({
  children,
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
    <div>{children}</div>
  </div>
);
