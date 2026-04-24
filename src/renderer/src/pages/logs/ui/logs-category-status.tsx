import type { ReactElement, TransitionStartFunction } from 'react';
import { LOG_CATEGORIES, type LogCategory } from '../model/use-log-tail';

interface LogsCategoryStatusProps {
  categories: Set<LogCategory>;
  setCategories: (categories: Set<LogCategory>) => void;
  startTransition: TransitionStartFunction;
  statusText: string;
}

export const LogsCategoryStatus = ({
  categories,
  setCategories,
  startTransition,
  statusText,
}: LogsCategoryStatusProps): ReactElement => {
  const handleCategoryToggle = (category: LogCategory): void => {
    if (!category) return;
    startTransition(() => {
      const next = new Set(categories);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      setCategories(next);
    });
  };

  return (
    <div className="panel__body" style={{ display: 'grid', gap: '0.65rem', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted">카테고리:</span>
        {LOG_CATEGORIES.filter((category) => category !== '').map((category) => (
          <label
            key={category}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.6rem',
              border: categories.has(category) ? '1px solid #0f0' : '1px solid #666',
              borderRadius: '0.25rem',
              backgroundColor: categories.has(category) ? 'rgba(0, 255, 0, 0.1)' : 'transparent',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'background-color 160ms ease, border-color 160ms ease',
            }}
          >
            <input
              type="checkbox"
              checked={categories.has(category)}
              onChange={() => handleCategoryToggle(category)}
              style={{ cursor: 'pointer' }}
            />
            {category}
          </label>
        ))}
      </div>
      <div
        aria-live="polite"
        style={{
          alignItems: 'center',
          background:
            'linear-gradient(180deg, var(--bg-2, rgba(0,0,0,0.03)) 0%, var(--bg-3, rgba(0,0,0,0.05)) 100%)',
          border: '0.1rem solid var(--border, rgba(0,0,0,0.12))',
          borderRadius: '0.45rem',
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
