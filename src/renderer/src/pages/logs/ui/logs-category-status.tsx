import { Checkbox } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { LOG_CATEGORIES, type LogCategory } from '../model/use-log-tail';

interface LogsCategoryStatusProps {
  categories: Set<LogCategory>;
  setCategories: (categories: Set<LogCategory>) => void;
  statusText: string;
}

export const LogsCategoryStatus = ({
  categories,
  setCategories,
  statusText,
}: LogsCategoryStatusProps): ReactElement => {
  const handleCategoryToggle = (category: LogCategory): void => {
    if (!category) return;
    const next = new Set(categories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    setCategories(next);
  };

  return (
    <div className="panel__body" style={{ display: 'grid', gap: '0.65rem', flexShrink: 0 }}>
      <fieldset className="logs-category-filter">
        <legend className="muted logs-category-filter__legend">카테고리</legend>
        {LOG_CATEGORIES.filter((category) => category !== '').map((category) => (
          <Checkbox
            key={category}
            checked={categories.has(category)}
            className={[
              'logs-category-filter__choice',
              categories.has(category) ? 'logs-category-filter__choice--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            dense
            label={category}
            onChange={() => handleCategoryToggle(category)}
          />
        ))}
      </fieldset>
      <div
        aria-live="polite"
        className="logs-status-card"
        style={{
          alignItems: 'center',
          display: 'flex',
          minHeight: '2.8rem',
          overflow: 'hidden',
          padding: '0 0.8rem',
        }}
      >
        <div
          style={{
            color: 'var(--fg-2)',
            fontSize: '1.02rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%',
          }}
        >
          {statusText}
        </div>
      </div>
    </div>
  );
};
