import type { AriaRole, ReactElement, ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  role?: AriaRole;
  dense?: boolean;
}

export const EmptyState = ({
  action,
  dense = false,
  description,
  role = 'status',
  title,
}: EmptyStateProps): ReactElement => (
  <div
    className={['ui-empty-state', dense ? 'ui-empty-state--dense' : ''].join(' ').trim()}
    role={role}
  >
    <div className="ui-empty-state__copy">
      <strong className="ui-empty-state__title">{title}</strong>
      {description ? (
        <span className="ui-empty-state__description muted">{description}</span>
      ) : null}
    </div>
    {action ? <div className="ui-empty-state__action">{action}</div> : null}
  </div>
);
