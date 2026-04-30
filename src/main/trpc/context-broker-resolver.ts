import type { AppEnv } from '@shared/contracts';
import type { WsFactory } from '../brokers/core/types';
import { createBrokerPort } from '../brokers/factory';
import { KisRealtimeAdapter } from '../brokers/kis/realtime-adapter';
import { KiwoomAuth } from '../brokers/kiwoom/auth';
import { KiwoomSocketClient } from '../brokers/kiwoom/socket-client';
import { KiwoomTokenStore } from '../brokers/kiwoom/token-store';
import type { BrokerPort } from '../brokers/ports/broker-port';
import type { RealtimeService } from '../realtime/realtime-service';
import type { ContextFactoryOptions } from './context';

type BrokerResolverDeps = Omit<ContextFactoryOptions, 'realtimeFactory' | 'initialActiveAccountId'>;

interface ContextBrokerState {
  getCurrentEnv: () => AppEnv | null;
  getActiveAccountId: () => number | null;
  getRealtime: () => RealtimeService | null;
}

export interface ContextBrokerResolver {
  brokerForAccount: (accountId: number) => BrokerPort | null;
  clearBrokerCache: () => void;
}

const missingKiwoomWsFactory: WsFactory = (url) => {
  throw new Error(`Kiwoom WS factory not wired (url=${url})`);
};

export function createContextBrokerResolver(
  deps: BrokerResolverDeps,
  state: ContextBrokerState,
): ContextBrokerResolver {
  const brokerCache = new Map<string, BrokerPort>();

  const clearBrokerCache = (): void => {
    for (const port of brokerCache.values()) port.dispose();
    brokerCache.clear();
  };

  let kisRealtimeAdapter: KisRealtimeAdapter | null = null;
  const ensureKisRealtimeAdapter = (): KisRealtimeAdapter | undefined => {
    if (kisRealtimeAdapter) return kisRealtimeAdapter;
    if (!deps.bus) return undefined;
    kisRealtimeAdapter = new KisRealtimeAdapter({
      getService: state.getRealtime,
      bus: deps.bus,
      getHtsId: () => {
        const activeAccountId = state.getActiveAccountId();
        const currentEnv = state.getCurrentEnv();
        if (activeAccountId === null) return null;
        const cred = deps.credentialsRepo.loadCredentials(activeAccountId);
        if (cred.isErr() || !cred.value || cred.value.env !== currentEnv) return null;
        return cred.value.htsId?.trim() || null;
      },
    });
    return kisRealtimeAdapter;
  };

  const brokerForAccount = (accountId: number): BrokerPort | null => {
    const currentEnv = state.getCurrentEnv();
    if (!currentEnv) return null;
    const key = `${currentEnv}:${accountId}`;
    const cached = brokerCache.get(key);
    if (cached) return cached;
    const credResult = deps.credentialsRepo.loadCredentials(accountId);
    if (credResult.isErr() || !credResult.value) return null;
    const cred = credResult.value;
    if (cred.env !== currentEnv) return null;

    let port: BrokerPort;
    if (cred.broker === 'KIWOOM') {
      port = createBrokerPort({
        brokerId: 'KIWOOM',
        deps: {
          env: currentEnv,
          auth: new KiwoomAuth({
            env: currentEnv,
            appKey: cred.appKey,
            secretKey: cred.appSecret,
          }),
          http: deps.kiwoomHttpByEnv[currentEnv],
          tokenStore: deps.kiwoomTokenStore,
          tradingCalendar: deps.tradingCalendar,
          credentials: {
            appKey: cred.appKey,
            secretKey: cred.appSecret,
            accountNo: `${cred.accountNo8}${cred.accountProdCd}`,
          },
          socket: new KiwoomSocketClient({
            env: currentEnv,
            getToken: () => {
              const tokenEnv = state.getCurrentEnv();
              if (!tokenEnv) return null;
              const token = deps.kiwoomTokenStore.load(tokenEnv);
              if (token.isErr() || !token.value) return null;
              return KiwoomTokenStore.isReusable(token.value, Date.now())
                ? token.value.token
                : null;
            },
            factory: deps.kiwoomWsFactory ?? missingKiwoomWsFactory,
          }),
        },
      });
    } else {
      const realtimeAdapter = ensureKisRealtimeAdapter();
      const kisDeps = {
        env: currentEnv,
        httpByEnv: deps.httpByEnv,
        authService: deps.auth,
        credentials: {
          appKey: cred.appKey,
          appSecret: cred.appSecret,
          accountNo8: cred.accountNo8,
          accountProdCd: cred.accountProdCd,
          ...(cred.htsId !== undefined && { htsId: cred.htsId }),
        },
        logger: deps.logger,
        tradingCalendar: deps.tradingCalendar,
      };
      port = createBrokerPort({
        brokerId: 'KIS',
        deps: realtimeAdapter !== undefined ? { ...kisDeps, realtime: realtimeAdapter } : kisDeps,
      });
    }

    brokerCache.set(key, port);
    return port;
  };

  return { brokerForAccount, clearBrokerCache };
}
