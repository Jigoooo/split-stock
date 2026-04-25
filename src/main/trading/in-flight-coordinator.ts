/**
 * StrategyExecutionEngine 과 WatchEngine 가 같은 (accountId, pdno) 종목에 대해
 * 동일 tick 으로 동시에 fire 하지 못하도록 source 간 dedupe 토큰을 발급/회수한다.
 *
 * - StrategyExecutionEngine 내부의 inFlightPdnos 는 strategy 한정 dedupe 였고
 *   WatchEngine 의 entry.inFlight 는 entry 단위 dedupe 였기 때문에,
 *   둘 사이의 cross-source 중복 발사가 가능했다 (B/A2 항목).
 * - Coordinator 는 단일 Set 으로 (accountId, pdno) 키를 들어올린다.
 * - 키가 이미 존재하면 acquire 실패 → 호출 측은 skip.
 */
export interface InFlightCoordinator {
  tryAcquire(accountId: number, pdno: string): boolean;
  release(accountId: number, pdno: string): void;
  has(accountId: number, pdno: string): boolean;
  size(): number;
}

export function createInFlightCoordinator(): InFlightCoordinator {
  const set = new Set<string>();
  const key = (accountId: number, pdno: string): string => `${accountId}:${pdno}`;

  return {
    tryAcquire(accountId, pdno) {
      const k = key(accountId, pdno);
      if (set.has(k)) return false;
      set.add(k);
      return true;
    },
    release(accountId, pdno) {
      set.delete(key(accountId, pdno));
    },
    has(accountId, pdno) {
      return set.has(key(accountId, pdno));
    },
    size() {
      return set.size;
    },
  };
}
