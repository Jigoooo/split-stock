import type { LineStyleType, MaPeriod } from '@renderer/entities/display-settings';

export const MA_LABEL: Record<MaPeriod, string> = {
  5: 'MA5',
  10: 'MA10',
  20: 'MA20',
  60: 'MA60',
  120: 'MA120',
};

export const LINE_STYLE_OPTIONS: Array<{ value: LineStyleType; label: string }> = [
  { value: 'solid', label: '실선' },
  { value: 'dashed', label: '점선' },
  { value: 'dotted', label: '점' },
];

export const colorInputStyle = {
  width: '4rem',
  height: '2.4rem',
  padding: '0.1rem',
  border: '0.1rem solid var(--border-strong)',
  borderRadius: '0.3rem',
  cursor: 'pointer',
} as const;
