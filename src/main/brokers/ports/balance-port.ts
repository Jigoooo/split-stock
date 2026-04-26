import type { Balance, BrokerError } from '@shared/contracts';
import type { Result } from '../core/result';

/**
 * 잔고 port — 보유 종목 + 예수금 + 평가금액.
 */
export interface BalancePort {
  inquireBalance(): Promise<Result<Balance, BrokerError>>;
}
