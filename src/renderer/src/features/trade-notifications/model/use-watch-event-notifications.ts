import { trpc } from '@renderer/shared/api/trpc';
import { useEffect, useEffectEvent } from 'react';
import { toast } from 'sonner';

export function useWatchEventNotifications(): void {
  const utils = trpc.useUtils();
  const invalidateWatchQueries = useEffectEvent(() => {
    void Promise.all([
      utils.watch.list.invalidate(),
      utils.watch.getControlState.invalidate(),
      utils.watch.history.invalidate(),
    ]);
  });

  useEffect(() => {
    const unsubscribe = window.appShell?.onWatchEvent?.((event) => {
      const base = `${event.pdno} · ${event.side === 'BUY' ? '매수' : '매도'} · 목표가 ${event.targetPrice.toLocaleString('ko-KR')}원`;
      switch (event.status) {
        case 'EXECUTED':
          toast.success(`자동감시 실행: ${base}`);
          break;
        case 'FAILED':
          toast.error(
            `자동감시 실패: ${base}${event.failureReason ? ` · ${event.failureReason}` : ''}`,
          );
          break;
        case 'EXPIRED':
          toast(`자동감시 만료: ${base}`);
          break;
      }
      void Promise.all([
        utils.account.getBalanceWithLots.invalidate(),
        utils.account.getPositionOverlay.invalidate(),
        utils.lots.cyclesByPdno.invalidate(),
        utils.lots.tradeHistory.invalidate(),
        utils.order.listActive.invalidate(),
        utils.order.listMyFills.invalidate(),
        utils.watch.list.invalidate(),
        utils.watch.getControlState.invalidate(),
        utils.watch.history.invalidate(),
      ]);
    });
    return () => unsubscribe?.();
  }, [utils]);

  useEffect(() => {
    const unsubscribe = window.appShell?.onPopoutClosed?.((route) => {
      if (route !== 'add-watch-order') {
        return;
      }
      invalidateWatchQueries();
    });
    return () => unsubscribe?.();
  }, []);
}
