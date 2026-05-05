import type { ReactNode } from 'react';

/**
 * TradeHistoryShell 의 5탭 키 — broker 무관.
 *  - strategy : 자동매매 설정 (broker 별 form)
 *  - all      : 전체보기 (진행중 + 종료)
 *  - open     : 진행중 사이클
 *  - closed   : 종료 사이클
 *  - memo     : 종목메모 (broker 별 form)
 */
export type TradeHistoryShellTabKey = 'all' | 'open' | 'closed' | 'strategy' | 'memo';

/**
 * Shell 의 status 필터 (history 패널이 어떤 상태를 표시할지).
 *  strategy/memo 탭은 history slot 을 호출하지 않으므로 'all'/'open'/'closed' 만 노출.
 */
export type TradeHistoryShellStatus = 'all' | 'open' | 'closed';

/**
 * Shell 이 broker 별 컴포넌트를 받는 slot.
 *
 * - configPanel: symbol 이 null 일 때 shell 이 자동으로 EmptyHint 노출.
 *                Slot 은 symbol 비어있지 않은 case 만 처리하면 된다.
 * - historyPanel: status 별 다른 데이터/컬럼 — broker 가 자기 형식으로 채움.
 * - memoPanel: configPanel 동일 — symbol 비어있지 않은 case 만 처리.
 */
export interface TradeHistoryShellSlots {
  configPanel: (symbol: string) => ReactNode;
  historyPanel: (status: TradeHistoryShellStatus, symbol: string | null) => ReactNode;
  memoPanel: (symbol: string) => ReactNode;
}

/**
 * Shell 의 빈 상태 안내문 — broker 별 다른 표현 가능 (선택적).
 */
export interface TradeHistoryShellHints {
  /** strategy 탭 + symbol === null 시 안내문. */
  strategy?: string;
  /** memo 탭 + symbol === null 시 안내문. */
  memo?: string;
}

/**
 * TradeHistoryShell props — broker-agnostic.
 *
 * stock 측은 pdno + 종목명, crypto 측은 market + 한글명 으로 채운다.
 */
export interface TradeHistoryShellProps {
  /** pdno (stock) 또는 market (crypto). null 이면 strategy/memo 탭 비활성화. */
  symbol: string | null;
  /** 표시용 라벨 — "메리츠금융지주 (256940)" 또는 "비트코인 (KRW-BTC)". 현재는 ariaLabel 보조용. */
  symbolLabel?: string;
  /** 빈 상태 안내문 override. */
  symbolHintText?: TradeHistoryShellHints;
  /** 컨테이너 aria-label. 기본값은 "매매내역 패널". */
  ariaLabel?: string;
  /** 기본 활성 탭. 기본값 'strategy'. */
  initialTab?: TradeHistoryShellTabKey;
  /** broker 별 slot. */
  slots: TradeHistoryShellSlots;
}
