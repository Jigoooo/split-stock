import type { WatchOrder } from '@renderer/entities/watch-order';
import { formatDateTime, formatDateTimeLongKo } from '@renderer/shared/lib/formatter';

export function statusLabel(status: WatchOrder['status']): string {
  switch (status) {
    case 'WATCHING':
      return '감시중';
    case 'PAUSED':
      return '일시중지';
    case 'EXECUTED':
      return '실행';
    case 'FAILED':
      return '실패';
    case 'EXPIRED':
      return '만료';
    case 'CANCELLED':
      return '삭제';
  }
}

export function sourceLabel(source: WatchOrder['source']): string {
  switch (source) {
    case 'BOOSTER':
      return '구버전';
    case 'PREBUY':
    case 'CUSTOM':
      return '예약매수';
  }
}

export function formatWatchDate(d: Date | string | number): string {
  return formatDateTime(d);
}

export function formatWatchDateTitle(d: Date | string | number): string {
  return formatDateTimeLongKo(d);
}
