export type LotsRepoError =
  | { kind: 'DB_ERROR'; cause: unknown }
  | { kind: 'NOT_FOUND'; lotId: number }
  | { kind: 'CONFLICT'; reason: string }
  | { kind: 'NO_HISTORY'; reason: string }
  | { kind: 'INVALID_ACCOUNT'; accountId: number };

/** LotsRepoError 의 사람이 읽을 수 있는 메시지 — 라우터/로거 공용. */
export function lotsRepoErrorMessage(e: LotsRepoError): string {
  switch (e.kind) {
    case 'DB_ERROR':
      return String(e.cause ?? 'unknown DB error');
    case 'NOT_FOUND':
      return `lot 없음 (id=${e.lotId})`;
    case 'CONFLICT':
      return e.reason;
    case 'NO_HISTORY':
      return e.reason;
    case 'INVALID_ACCOUNT':
      return `계좌 ${e.accountId} 가 존재하지 않거나 도메스틱 broker (KIS/KIWOOM) 가 아닙니다`;
  }
}
