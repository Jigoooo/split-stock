export type AutoOrderBlockCode =
  | 'MARKET_WEEKEND'
  | 'MARKET_TIME_CLOSED'
  | 'MARKET_CLOSED_DAY'
  | 'MARKET_SESSION_UNKNOWN'
  | 'AUTO_BUY_PROTECTION_LIMIT'
  | 'AUTO_BUY_TIME_WINDOW'
  | 'AUTO_BUY_RATE_GUARD';

export class AutoOrderBlockedError extends Error {
  readonly keepWatching = true;

  constructor(
    readonly code: AutoOrderBlockCode,
    message: string,
  ) {
    super(message);
    this.name = 'AutoOrderBlockedError';
  }
}

export function isAutoOrderBlockedError(error: unknown): error is AutoOrderBlockedError {
  return error instanceof AutoOrderBlockedError;
}
