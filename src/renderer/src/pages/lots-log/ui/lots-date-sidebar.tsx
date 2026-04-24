import type { ReactElement } from 'react';

interface LotsDateSidebarProps {
  dates: string[];
  datesLoading: boolean;
  onSelectDate: (date: string) => void;
  selectedDate: string | null;
}

export const LotsDateSidebar = ({
  dates,
  datesLoading,
  onSelectDate,
  selectedDate,
}: LotsDateSidebarProps): ReactElement => (
  <div
    style={{
      width: '9rem',
      borderRight: '1px solid var(--hts-line, rgba(0,0,0,0.1))',
      overflowY: 'auto',
      flexShrink: 0,
    }}
  >
    <div
      style={{
        padding: '0.5rem 0.6rem',
        fontWeight: 600,
        fontSize: '1.1rem',
        borderBottom: '1px solid var(--hts-line, rgba(0,0,0,0.08))',
      }}
    >
      일자
    </div>
    {datesLoading ? (
      <div className="muted" style={{ padding: '0.6rem' }}>
        로드 중…
      </div>
    ) : dates.length === 0 ? (
      <div className="muted" style={{ padding: '0.6rem', fontSize: '1.05rem' }}>
        스냅샷 없음
      </div>
    ) : (
      dates.map((date) => (
        <button
          key={date}
          type="button"
          onClick={() => onSelectDate(date)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '0.4rem 0.6rem',
            background: date === selectedDate ? 'var(--hts-accent-bg, #e8f0fe)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontWeight: date === selectedDate ? 600 : 400,
            fontSize: '1.05rem',
            color: 'var(--hts-text, inherit)',
          }}
        >
          {date}
        </button>
      ))
    )}
  </div>
);
