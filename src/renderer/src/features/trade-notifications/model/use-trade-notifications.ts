import type { TradeExecutionEvent } from '@shared/contracts';
import type { CniNotice } from '@shared/contracts/kis';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * 체결통보 이벤트를 리슨하고 Sonner toast + Electron OS 알림을 발송하는 hook.
 *
 * 사용:
 * - 페이지/루트 레벨에서 한 번만 호출
 * - useOnTradeEvent로 deps 오염 방지 (React 19 useEffectEvent)
 */
export function useTradeNotifications(): void {
  useEffect(() => {
    const unsubscribe = window.appShell?.onTradeEvent?.((event) => {
      processTradeExecutionEvent(event);
    });
    return () => unsubscribe?.();
  }, []);
}

/**
 * (내부용) CniNotice를 처리하고 toast + OS 알림을 발송.
 * @param notice WS 체결통보 메시지
 */
export async function processCniNotice(
  notice: CniNotice,
  options?: {
    osNotificationsEnabled?: boolean;
  },
): Promise<void> {
  try {
    // CniNotice.raw는 '^'로 구분된 파이프라인 데이터
    // 실제 파싱은 KIS 도메인에서 하고, 여기선 toast/alert 발송만
    // Path B에서 상세 파싱 로직 추가 예정

    // Toast: "매수 체결: 종목명 N주 @가격"
    // 현재는 미니멀 구현 (raw 레코드 기반)
    const toastMsg = `체결통보 수신: ${notice.tr} (seq=${notice.seq})`;
    toast.success(toastMsg, {
      duration: 3000,
    });

    // OS 알림 (설정 활성화 시)
    if (options?.osNotificationsEnabled) {
      // main-preload에서 exposed된 trpc를 통해 main.notification.notifyTrade 호출
      // 현재는 Path B 대기 중
    }
  } catch (error) {
    toast.error(`체결통보 처리 실패: ${error instanceof Error ? error.message : '알 수 없음'}`);
  }
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
