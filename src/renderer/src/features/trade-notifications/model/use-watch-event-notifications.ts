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
        // EXPIRED 는 빈도가 높아 toast 제거. event_logs / reports 의 일일 운영 요약(자동감시 실행/실패)
        // 으로 사용자가 사후 확인 가능. 만료된 watch 는 자동감시 탭의 '히스토리'에서도 노출.
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
    const unsubscribe = window.appShell?.onAutoOrderRetryEvent?.((event) => {
      const sideLabel = event.side === 'BUY' ? '자동매수' : '자동매도';
      const retryLabel =
        event.retryAfterMs === null
          ? '조건 유지 시 재시도'
          : `${Math.ceil(event.retryAfterMs / 1000)}초 후 재시도`;
      toast.warning(
        `${sideLabel} 재시도 대기: ${event.pdno} · ${event.nth}차 · ${retryLabel} · ${event.reason}`,
      );
    });
    return () => unsubscribe?.();
  }, []);

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
