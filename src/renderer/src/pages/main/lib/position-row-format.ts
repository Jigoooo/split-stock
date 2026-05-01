import type { LotEntry } from '@renderer/entities/account';
import type { BalanceStageCellMode } from '@renderer/entities/display-settings';
import {
  formatDateOnly,
  formatDateTimeLongKo,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';

export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(Math.round(value))}`;
}

export function formatKrw(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return thousandSeparator(Math.round(value));
}

export function getPnlColorClass(value: number): string {
  if (value > 0) return 'num-up';
  if (value < 0) return 'num-down';
  return 'num-flat';
}

export function formatStageCell(
  mode: BalanceStageCellMode,
  lot: LotEntry,
  stagePnlRate: number | null,
): string {
  if (lot.status === 'SELLING') {
    return mode === 'QTY' ? `매도중 ${thousandSeparator(lot.qty)}주` : '매도중';
  }
  switch (mode) {
    case 'DATE':
      return formatDateOnly(lot.boughtAt);
    case 'QTY':
      return thousandSeparator(lot.qty);
    case 'PERCENT':
      return stagePnlRate === null ? '-' : `${stagePnlRate.toFixed(2)}%`;
  }
}

export function formatStageTitle(nth: number, lot: LotEntry, stagePnlRate: number | null): string {
  return [
    `${nth}차`,
    lot.status === 'SELLING' ? '매도중/체결 반영 중' : lot.status,
    `매수일 ${formatDateTimeLongKo(lot.boughtAt)}`,
    `수량 ${thousandSeparator(lot.qty)}주`,
    `수익률 ${stagePnlRate === null ? '-' : `${stagePnlRate.toFixed(2)}%`}`,
  ].join(' · ');
}
