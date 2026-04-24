import type { ReactElement } from 'react';

export const ErrorChip = ({ message }: { message: string }): ReactElement => (
  <span className="chip chip--down" role="alert">
    {message}
  </span>
);
