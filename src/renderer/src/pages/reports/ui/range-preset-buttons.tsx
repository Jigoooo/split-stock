import { Button } from '@renderer/shared/ui';
import { type ReactElement, useMemo } from 'react';

export interface RangePresetButtonsProps {
  fromStr: string;
  toStr: string;
  onChange: (from: string, to: string) => void;
}

interface PresetSpec {
  id: string;
  label: string;
  compute: (today: Date) => { from: string; to: string };
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PRESETS: PresetSpec[] = [
  {
    id: 'today',
    label: '오늘',
    compute: (today) => ({ from: isoDate(today), to: isoDate(today) }),
  },
  {
    id: 'this-week',
    label: '이번 주',
    compute: (today) => {
      const d = new Date(today);
      const day = d.getDay(); // 0 = Sunday
      const diff = day === 0 ? -6 : 1 - day; // 월요일 시작
      d.setDate(d.getDate() + diff);
      return { from: isoDate(d), to: isoDate(today) };
    },
  },
  {
    id: 'this-month',
    label: '이번 달',
    compute: (today) => {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: isoDate(d), to: isoDate(today) };
    },
  },
  {
    id: 'ytd',
    label: 'YTD',
    compute: (today) => {
      const d = new Date(today.getFullYear(), 0, 1);
      return { from: isoDate(d), to: isoDate(today) };
    },
  },
  {
    id: 'last-30',
    label: '최근 30일',
    compute: (today) => {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { from: isoDate(d), to: isoDate(today) };
    },
  },
  {
    id: 'last-90',
    label: '최근 90일',
    compute: (today) => {
      const d = new Date(today);
      d.setDate(d.getDate() - 89);
      return { from: isoDate(d), to: isoDate(today) };
    },
  },
];

export const RangePresetButtons = ({
  fromStr,
  toStr,
  onChange,
}: RangePresetButtonsProps): ReactElement => {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const computed = useMemo(() => PRESETS.map((p) => ({ ...p, range: p.compute(today) })), [today]);
  const activeId = computed.find((p) => p.range.from === fromStr && p.range.to === toStr)?.id;

  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {computed.map((p) => (
        <Button
          key={p.id}
          dense
          variant={activeId === p.id ? 'primary' : 'default'}
          onClick={() => onChange(p.range.from, p.range.to)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
};
