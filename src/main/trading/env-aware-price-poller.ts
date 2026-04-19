import type { AppEnv, KisError } from '@shared/contracts';
import { err, ok, type Result } from 'neverthrow';
import type { AuthService } from '../kis/auth';
import { inquirePrice } from '../kis/domestic-stock';
import type { KisHttpClient } from '../kis/http-client';
import { makeKisError } from '../kis/errors';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { PricePoller } from './tiered-quote-feed';

export interface EnvAwarePricePollerOptions {
  /** 현재 활성 env 를 lazy 로 끌어쓰기 위한 getter. null 이면 NETWORK 에러 반환. */
  getEnv: () => AppEnv | null;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
}

/**
 * 활성 env / 자격증명 / 토큰을 매 fetch 마다 lazy 로 끌어쓰는 PricePoller.
 *
 * 설계:
 * - env 가 null 이거나 자격증명이 없으면 NETWORK 에러 반환 → RotatingQuoteFeed 가 쿨다운 처리.
 * - 토큰 발급은 AuthService 가 6h 캐시 로직을 가지고 있어 매 호출마다 HTTP 가 일어나지는 않음.
 * - env 전환 시점에 본 인스턴스를 교체하지 않아도 다음 fetch 에서 자동으로 새 env 사용.
 */
export function createEnvAwarePricePoller(opts: EnvAwarePricePollerOptions): PricePoller {
  return {
    fetch: async (pdno): Promise<Result<{ price: number }, KisError>> => {
      const env = opts.getEnv();
      if (!env) {
        return err(makeKisError('NETWORK', 'env not selected'));
      }
      const credResult = opts.credentialsRepo.loadCredentialsByEnv(env);
      if (credResult.isErr() || !credResult.value) {
        return err(makeKisError('NETWORK', `credentials missing for env=${env}`));
      }
      const cred = credResult.value;
      const tokenResult = await opts.auth.getValidToken(env, cred.appKey, cred.appSecret);
      if (tokenResult.isErr()) return err(tokenResult.error);
      const r = await inquirePrice(
        {
          http: opts.httpByEnv[env],
          env,
          token: tokenResult.value.token,
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
        },
        pdno,
      );
      if (r.isErr()) return err(r.error);
      return ok({ price: r.value.price });
    },
  };
}
