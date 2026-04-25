import { trpc } from '@renderer/shared/api/trpc';
import type { TradeExecutionEvent } from '@shared/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * 체결통보 이벤트를 리슨하고 Sonner toast를 발송하는 hook.
 * - 페이지/루트 레벨에서 한 번만 호출.
 */
export function useTradeNotifications(): void {
  const utils = trpc.useUtils();

  useEffect(() => {
    const unsubscribe = window.appShell?.onTradeEvent?.((event) => {
      processTradeExecutionEvent(event);
      void Promise.all([
        utils.account.getBalanceWithLots.invalidate(),
        utils.account.getPositionOverlay.invalidate(),
        utils.lots.cyclesByPdno.invalidate(),
        utils.lots.tradeHistory.invalidate(),
        utils.order.listActive.invalidate(),
        utils.order.listMyFills.invalidate(),
      ]);
    });
    return () => unsubscribe?.();
  }, [utils]);
}

export function processTradeExecutionEvent(event: TradeExecutionEvent): void {
  const statusLabel = event.status === 'FILLED' ? '체결 완료' : '부분 체결';
  const body = `${event.name} · ${event.side === 'BUY' ? '매수' : '매도'} · ${event.filledQty.toLocaleString(
    'ko-KR',
  )}주 @ ${event.price.toLocaleString('ko-KR')}원`;
  toast.success(`${statusLabel}: ${body}`, {
    duration: 3000,
  });
}
