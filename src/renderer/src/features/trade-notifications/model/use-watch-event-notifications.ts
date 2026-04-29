import { trpc } from '@renderer/shared/api/trpc';
import { type AutoOrderRetryEvent, AutoOrderRetryEventSchema } from '@shared/contracts';
import { useEffect, useEffectEvent, useRef } from 'react';
import { toast } from 'sonner';

const AUTO_ORDER_TOAST_THROTTLE_MS = 60_000;

export function useWatchEventNotifications(): void {
  const utils = trpc.useUtils();
  const autoOrderToastLastAt = useRef(new Map<string, number>());
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
      const parsed = AutoOrderRetryEventSchema.safeParse(event);
      if (!parsed.success) return;
      const payload = parsed.data;
      const toastKey = autoOrderToastKey(payload);
      const now = Date.now();
      const lastAt = autoOrderToastLastAt.current.get(toastKey);
      if (lastAt !== undefined && now - lastAt < AUTO_ORDER_TOAST_THROTTLE_MS) return;
      autoOrderToastLastAt.current.set(toastKey, now);

      const formatted = formatAutoOrderRetryToast(payload);
      switch (formatted.tone) {
        case 'success':
          toast.success(formatted.message);
          break;
        case 'warning':
          toast.warning(formatted.message);
          break;
      }
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

export function formatAutoOrderRetryToast(event: AutoOrderRetryEvent): {
  message: string;
  tone: 'success' | 'warning';
} {
  const sideLabel = event.side === 'BUY' ? '자동매수' : '자동매도';
  const stageLabel = `${event.nth}차`;
  const reasonLabel = event.reason ? ` · ${event.reason}` : '';
  switch (event.status) {
    case 'RETRYING': {
      const retryLabel =
        event.retryAfterMs === null
          ? '다시 확인 대기'
          : `${Math.ceil(event.retryAfterMs / 1000)}초 후 다시 확인`;
      return {
        message: `${sideLabel} 재시도 중: ${event.pdno} · ${stageLabel} · ${retryLabel}${reasonLabel}`,
        tone: 'warning',
      };
    }
    case 'WAITING_CONDITION':
      return {
        message: `${sideLabel} 대기: ${event.pdno} · ${stageLabel} · 조건이 다시 맞으면 확인${reasonLabel}`,
        tone: 'warning',
      };
    case 'NEEDS_ATTENTION':
      return {
        message: `${sideLabel} 확인 필요: ${event.pdno} · ${stageLabel}${reasonLabel}`,
        tone: 'warning',
      };
    case 'RECONCILED':
      return {
        message: `주문 접수 확인: ${event.pdno} · ${sideLabel} · ${stageLabel} · 기존 주문과 연결됨`,
        tone: 'success',
      };
  }
}

function autoOrderToastKey(event: AutoOrderRetryEvent): string {
  return `${event.accountId}:${event.pdno}:${event.side}:${event.nth}:${event.status}`;
}
