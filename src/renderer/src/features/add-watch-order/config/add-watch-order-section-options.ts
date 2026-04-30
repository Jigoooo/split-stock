import type { WatchOrderType, WatchQtyMode } from '@renderer/entities/watch-order';
import type { CSSProperties } from 'react';

export const ORDER_TYPE_ITEMS: ReadonlyArray<{ value: WatchOrderType; label: string }> = [
  { value: 'LIMIT', label: '지정가' },
  { value: 'MARKET', label: '시장가' },
];

export const QTY_MODE_ITEMS: ReadonlyArray<{ value: WatchQtyMode; label: string }> = [
  { value: 'QTY', label: '수량' },
  { value: 'AMOUNT', label: '금액' },
];

export const EXPIRY_QUICK: ReadonlyArray<{ months: number; label: string }> = [
  { months: 1, label: '1개월' },
  { months: 3, label: '3개월' },
  { months: 12, label: '1년' },
];

export const AMOUNT_QUICK: ReadonlyArray<{ delta: number; label: string }> = [
  { delta: 100_000, label: '+10만' },
  { delta: 500_000, label: '+50만' },
  { delta: 1_000_000, label: '+100만' },
  { delta: 5_000_000, label: '+500만' },
  { delta: 10_000_000, label: '+1000만' },
];

export const sectionCardStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'grid',
  gap: isPageLayout ? '1.05rem' : '0.78rem',
  alignContent: 'start',
  padding: isPageLayout ? '1.15rem' : '0.9rem',
  border: '0.1rem solid var(--border)',
  borderRadius: '0.5rem',
  background: 'var(--bg)',
  boxShadow: 'none',
});

export const sectionHeaderStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  paddingBottom: isPageLayout ? '0.6rem' : '0.45rem',
  borderBottom: '0.1rem solid var(--border)',
});

export const sectionTitleStyle = (isPageLayout: boolean): CSSProperties => ({
  fontSize: isPageLayout ? '1.12rem' : '1.02rem',
  fontWeight: 800,
  color: 'var(--fg)',
  letterSpacing: 0,
});

export const formLabelStyle = (): CSSProperties => ({
  paddingTop: '0.36rem',
  fontSize: '1.02rem',
  fontWeight: 800,
  color: 'var(--fg)',
  letterSpacing: 0,
});

export const panelLabelStyle = (): CSSProperties => ({
  fontSize: '1rem',
  fontWeight: 800,
  color: 'var(--fg-2)',
  letterSpacing: 0,
});

export const priceValueStyle = (isPrimary = false): CSSProperties => ({
  fontSize: isPrimary ? '1.6rem' : '1.08rem',
  fontWeight: isPrimary ? 850 : 800,
  color: 'var(--fg)',
  lineHeight: 1.15,
});

export const stripStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'grid',
  gap: isPageLayout ? '0.45rem' : '0.32rem',
  padding: isPageLayout ? '0.65rem 0.75rem' : '0.5rem 0.6rem',
  borderRadius: '0.45rem',
  border: '0.1rem solid var(--border)',
  background: 'var(--bg-2)',
});

export const metricRailStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: isPageLayout ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
  gap: '0.45rem',
  fontSize: isPageLayout ? '0.96rem' : '0.9rem',
});

export const candidateGridStyle = (isPageLayout: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: isPageLayout
    ? 'repeat(3, minmax(0, 1fr))'
    : 'repeat(auto-fit, minmax(8.8rem, 1fr))',
  gap: '0.45rem',
});
