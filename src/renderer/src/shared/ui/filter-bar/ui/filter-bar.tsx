import type { ReactElement, ReactNode } from 'react';

export interface FilterBarProps {
  children?: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
  dense?: boolean;
}

export const FilterBar = ({
  actions,
  ariaLabel,
  children,
  dense = false,
}: FilterBarProps): ReactElement => (
  <fieldset className={['ui-filter-bar', dense ? 'ui-filter-bar--dense' : ''].join(' ').trim()}>
    {ariaLabel ? <legend className="sr-only">{ariaLabel}</legend> : null}
    <div className="ui-filter-bar__controls">{children}</div>
    {actions ? <div className="ui-filter-bar__actions">{actions}</div> : null}
  </fieldset>
);
