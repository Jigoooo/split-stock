import type { BrokerError } from '@shared/contracts';
import { makeBrokerError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { PricePoller } from './tiered-quote-feed';

export interface EnvAwarePricePollerOptions {
  /**
   * 현재 활성 BrokerPort 를 lazy 로 끌어쓰기 위한 getter.
   *
   * null 이면 NETWORK 에러 반환 → RotatingQuoteFeed 가 쿨다운 처리.
   * env/계좌 전환 시 본 인스턴스를 교체하지 않아도 다음 fetch 에서 자동 새 broker 사용.
   */
  getBroker: () => BrokerPort | null;
}

/**
 * 활성 BrokerPort 를 매 fetch 마다 lazy 로 끌어쓰는 PricePoller.
 *
 * Stage 4d 변경: env/credentialsRepo/AuthService/httpByEnv 직접 의존 제거 →
 * BrokerPort 추상으로 단순화. 토큰 캐시(6h)/EGW00123 자동 invalidate 등은 broker
 * 내부 책임. Kiwoom 활성 시에도 동일 polling 로직 재사용 가능.
 */
export function createEnvAwarePricePoller(opts: EnvAwarePricePollerOptions): PricePoller {
  return {
    fetch: async (pdno): Promise<Result<{ price: number }, BrokerError>> => {
      const broker = opts.getBroker();
      if (!broker) {
        return err(
          makeBrokerError({
            brokerId: 'KIS',
            kind: 'NETWORK',
            msg: 'broker not ready (env or credentials missing)',
          }),
        );
      }
      const r = await broker.getQuote(pdno);
      if (r.isErr()) return err(r.error);
      return ok({ price: r.value.price });
    },
  };
}
