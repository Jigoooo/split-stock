import type { CryptoExchangeError, CryptoExchangeErrorKind } from '@shared/contracts';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RateLimitPenaltyError,
  UnprocessableEntityError,
} from '@upbit-official/upbit-sdk';

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const retryAfter = headers?.get('retry-after');
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof APIError && error.name) return error.name;
  const raw = (error as { error?: unknown }).error;
  if (raw && typeof raw === 'object') {
    const name =
      (raw as { name?: unknown; code?: unknown }).name ?? (raw as { code?: unknown }).code;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return undefined;
}

function classifyApiError(error: APIError): CryptoExchangeErrorKind {
  const code = errorCode(error);
  if (code === 'out_of_scope') return 'PERMISSION_DENIED';
  if (code === 'INVALID_AUTH' || code?.includes('INVALID_AUTH')) return 'AUTH_FAILED';
  if (code === 'invalid_price_bid' || code === 'invalid_price_ask') return 'VALIDATION';
  if (error instanceof RateLimitPenaltyError) return 'RATE_LIMIT_PENALTY';
  if (error instanceof RateLimitError) return 'RATE_LIMITED';
  if (error instanceof AuthenticationError) return 'AUTH_FAILED';
  if (error instanceof PermissionDeniedError) return 'PERMISSION_DENIED';
  if (error instanceof NotFoundError) return 'NOT_FOUND';
  if (error instanceof UnprocessableEntityError) return 'VALIDATION';
  if (error instanceof BadRequestError) {
    if (code?.includes('insufficient_funds') || code?.includes('under_min_total')) {
      return 'BUSINESS';
    }
    return 'VALIDATION';
  }
  if (error instanceof APIConnectionTimeoutError || error instanceof APIConnectionError) {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

export function toUpbitExchangeError(cause: unknown): CryptoExchangeError {
  if (cause instanceof APIError) {
    const error: CryptoExchangeError = {
      exchangeId: 'UPBIT',
      kind: classifyApiError(cause),
      message: cause.message,
    };
    if (cause.status !== undefined) error.status = cause.status;
    const code = errorCode(cause);
    if (code !== undefined) error.code = code;
    const retryMs = retryAfterMs(cause.headers);
    if (retryMs !== undefined) error.retryAfterMs = retryMs;
    if (cause.error !== undefined) error.raw = cause.error;
    return error;
  }
  return {
    exchangeId: 'UPBIT',
    kind: 'UNKNOWN',
    message: cause instanceof Error ? cause.message : String(cause),
    raw: cause,
  };
}
