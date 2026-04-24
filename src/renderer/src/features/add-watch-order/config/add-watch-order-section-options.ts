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
  gap: isPageLayout ? '0.85rem' : '0.4rem',
  alignContent: 'start',
  padding: isPageLayout ? '1rem 1.1rem' : '0.7rem 0.8rem',
  border: '0.1rem solid var(--border)',
  borderRadius: isPageLayout ? '0.8rem' : '0.6rem',
  background: isPageLayout
    ? 'linear-gradient(180deg, var(--bg) 0%, var(--bg-3) 100%)'
    : 'var(--bg)',
  boxShadow: isPageLayout ? '0 0.6rem 1.6rem rgba(15, 23, 42, 0.05)' : 'none',
});
