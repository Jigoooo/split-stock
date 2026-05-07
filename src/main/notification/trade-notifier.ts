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

export interface SellOnlyAutoEvent {
  /** 'KIS' (도메스틱 종목) 또는 'UPBIT' (코인) — 알림 제목 분기 + renderer scope 분류용. */
  scope: 'KIS' | 'UPBIT';
  accountId: number;
  /** 도메스틱: pdno (6자리), 코인: KRW-BTC 형태 마켓 코드. */
  symbol: string;
  /** 종목명 — 도메스틱은 stock_master, 코인은 마켓 코드 그대로. */
  name?: string | null;
  /** 윈도우 내 감지된 자동매수 시도 횟수 (>= maxCount + 1). */
  count: number;
  /** RateGuard 윈도우 길이 (초). */
  windowSeconds: number;
  /** triggered timestamp (ms). renderer toast/banner debounce 에 사용. */
  occurredAt: number;
}

/**
 * RateGuard 가 종목/마켓을 SELL_ONLY 로 자동 전환했음을 사용자에게 즉시 통지.
 *
 * - OS Notification: 백그라운드에서도 알림 센터 / Toast 로 푸시.
 * - 호출측은 별도로 broadcastToAllWindows('appShell:auto-sell-only', event) 를 통해
 *   renderer toast/banner 트리거. 본 함수는 OS 레벨만 담당.
 */
export function notifySellOnlyAuto(event: SellOnlyAutoEvent): void {
  const subject =
    event.name && event.name.trim().length > 0 ? `${event.name} (${event.symbol})` : event.symbol;
  const scopeLabel = event.scope === 'UPBIT' ? '코인' : '주식';
  const title = `${scopeLabel} 자동매도 전환`;
  const body = `${subject} · ${event.windowSeconds}초 내 자동매수 ${event.count}회 감지 → 매도 전용으로 자동 전환`;

  try {
    new Notification({
      title,
      body,
      timeoutType: 'default',
    }).show();
  } catch (error) {
    console.warn('[trade-notifier] SellOnly Notification API 사용 불가', error);
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
