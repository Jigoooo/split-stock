import { Notification } from 'electron';

export interface TradeNotifyParams {
  pdno: string; // 종목 코드
  side: 'buy' | 'sell'; // 매수/매도
  qty: number; // 수량
  price: number; // 가격
  name?: string; // 종목명 (있으면 포함)
}

/**
 * Electron Notification API를 사용한 OS 체결통보 알림.
 * macOS: NSNotification → 알림 센터
 * Windows: Toast notification → 작업표시줄
 *
 * @param param 체결 정보
 */
export function notifyTrade(param: TradeNotifyParams): void {
  const sideKo = param.side === 'buy' ? '매수' : '매도';
  const title = `${sideKo} 체결`;
  const body = param.name
    ? `${param.name} ${param.qty}주 @ ${param.price.toLocaleString('ko-KR')}원`
    : `${param.pdno} ${param.qty}주 @ ${param.price.toLocaleString('ko-KR')}원`;

  try {
    new Notification({
      title,
      body,
      // icon은 Electron 기본 아이콘 사용 — exactOptionalPropertyTypes 위배 방지 위해 미지정
      timeoutType: 'default', // 자동 닫기 (Windows에서는 무시됨)
    }).show();
  } catch (error) {
    // Notification API 미지원 환경에서는 조용히 실패
    console.warn('[trade-notifier] Notification API 사용 불가', error);
  }
}
