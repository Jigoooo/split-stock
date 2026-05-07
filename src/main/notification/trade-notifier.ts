import type { WatchOutcomeEvent } from '@shared/contracts';
import { Notification } from 'electron';

export interface TradeNotifyParams {
  pdno: string; // 종목 코드 또는 코인 마켓 (KRW-BTC)
  side: 'buy' | 'sell'; // 매수/매도
  qty: number; // 수량
  price: number; // 가격 (지정가) — 0이면 표시 생략
  name?: string; // 종목명 (있으면 포함)
  /** 수량 단위 — 기본 '주', 코인은 마켓별 base currency('BTC' 등). */
  qtyUnit?: string;
  /** 가격 단위 — 기본 '원'. */
  priceUnit?: string;
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
  const qtyUnit = param.qtyUnit ?? '주';
  const priceUnit = param.priceUnit ?? '원';
  const subject = param.name ?? param.pdno;
  const priceText = param.price > 0 ? ` @ ${param.price.toLocaleString('ko-KR')}${priceUnit}` : '';
  const body = `${subject} ${param.qty}${qtyUnit}${priceText}`;

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

export function notifyWatchOutcome(event: WatchOutcomeEvent, name?: string | null): void {
  const statusLabel =
    event.status === 'EXECUTED'
      ? '자동감시 실행'
      : event.status === 'FAILED'
        ? '자동감시 실패'
        : '자동감시 만료';
  // 종목명 있으면 "삼성전자 (005930)" 형태로 표시 — notifyTrade 와 일관.
  const subject = name && name.trim().length > 0 ? `${name} (${event.pdno})` : event.pdno;
  const bodyParts = [
    subject,
    `${event.side === 'BUY' ? '매수' : '매도'}`,
    `목표가 ${event.targetPrice.toLocaleString('ko-KR')}원`,
  ];
  if (event.triggerPrice !== null) {
    bodyParts.push(`감지가 ${event.triggerPrice.toLocaleString('ko-KR')}원`);
  }
  if (event.failureReason) {
    bodyParts.push(event.failureReason);
  }

  try {
    new Notification({
      title: statusLabel,
      body: bodyParts.join(' · '),
      timeoutType: 'default',
    }).show();
  } catch (error) {
    console.warn('[trade-notifier] Watch Notification API 사용 불가', error);
  }
}
