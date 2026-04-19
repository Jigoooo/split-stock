import { trpc } from '@renderer/shared/api/trpc';
import type { CniNotice } from '@shared/contracts/kis';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useOnTradeEvent } from './use-on-trade-event';

/**
 * 체결통보 이벤트를 리슨하고 Sonner toast + Electron OS 알림을 발송하는 hook.
 *
 * 사용:
 * - 페이지/루트 레벨에서 한 번만 호출
 * - useOnTradeEvent로 deps 오염 방지 (React 19 useEffectEvent)
 */
export function useTradeNotifications(): void {
  // settings는 향후 WS 구독 시점에 osEnabled 토글 적용에 사용 (Path B에서 wiring 예정)
  trpc.notifications.getSettings.useQuery(undefined, {
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // handleTradeEvent는 deps 오염 방지용 useEffectEvent 핸들러 — 추후 IPC/tRPC subscription에 wire-up
  useOnTradeEvent();

  useEffect(() => {
    // 향후 WS 체결 이벤트를 구독할 때:
    //   const unsubscribe = window.api.onTradeEvent?.(handleTradeEvent);
    //   return () => unsubscribe?.();
    // 현재는 Path B이므로 인터페이스만 준비. 실제 구독은 추후 w2-7에서.
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
