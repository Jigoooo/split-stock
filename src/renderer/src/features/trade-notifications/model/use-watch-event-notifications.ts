import { useEffect } from 'react';
import { toast } from 'sonner';

export function useWatchEventNotifications(): void {
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
    });
    return () => unsubscribe?.();
  }, []);
}
