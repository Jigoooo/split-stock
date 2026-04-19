import type { CniNotice } from '@shared/contracts/kis';
import { useEffectEvent } from 'react';
import { processCniNotice } from './use-trade-notifications';

/**
 * React 19 useEffectEvent로 trade 이벤트 핸들러를 분리.
 * deps 오염을 방지하고 이벤트 핸들러를 재정의 없이 유지.
 *
 * 반환된 핸들러는 effect 외부에서도 안전하게 호출 가능:
 * - WS onCniNotice 콜백에 등록
 * - 테스트에서 직접 호출
 * - IPC 메시지 핸들러로 사용
 */
export function useOnTradeEvent() {
  // useEffectEvent: deps 오염 없이 최신 state에 접근
  const handleTrade = useEffectEvent(async (notice: CniNotice, osNotificationsEnabled = false) => {
    await processCniNotice(notice, { osNotificationsEnabled });
  });

  return handleTrade;
}
