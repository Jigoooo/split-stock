import type { ReactElement, ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
}

export const PageHeader = ({
  actions,
  dense = false,
  description,
  meta,
  title,
}: PageHeaderProps): ReactElement => (
  <header className={['ui-page-header', dense ? 'ui-page-header--dense' : ''].join(' ').trim()}>
    <div className="ui-page-header__copy">
      <div className="ui-page-header__title-row">
        <h1 className="ui-page-header__title">{title}</h1>
        {meta ? <div className="ui-page-header__meta">{meta}</div> : null}
      </div>
      {description ? <p className="ui-page-header__description">{description}</p> : null}
    </div>
    {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
  </header>
);
