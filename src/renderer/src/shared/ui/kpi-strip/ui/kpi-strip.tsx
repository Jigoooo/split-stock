import type { ReactElement, ReactNode } from 'react';

export type KpiTone = 'default' | 'up' | 'down' | 'muted';

export interface KpiStripItem {
  id?: string;
  label: ReactNode;
  value: ReactNode;
  tone?: KpiTone;
  title?: string;
}

export interface KpiStripProps {
  items: ReadonlyArray<KpiStripItem>;
  dense?: boolean;
  ariaLabel?: string;
}

export const KpiStrip = ({ ariaLabel, dense = false, items }: KpiStripProps): ReactElement => (
  <dl
    className={['ui-kpi-strip', dense ? 'ui-kpi-strip--dense' : ''].join(' ').trim()}
    aria-label={ariaLabel}
  >
    {items.map((item) => {
      const tone = item.tone ?? 'default';
      return (
        <div
          key={item.id ?? String(item.label)}
          className={`ui-kpi-strip__item ui-kpi-strip__item--${tone}`}
          title={item.title}
        >
          <dt className="ui-kpi-strip__label">{item.label}</dt>
          <dd className="ui-kpi-strip__value num">{item.value}</dd>
        </div>
      );
    })}
  </dl>
);
