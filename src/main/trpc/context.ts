import type { AppEnv } from '@shared/contracts';
import type { Db } from '../db/client';
import type { AuthService } from '../kis/auth';
import type { KisHttpClient } from '../kis/http-client';
import type { CredentialsRepo } from '../security/credentials-repo';

/**
 * main 프로세스에서 tRPC 요청 당 주입되는 의존성.
 * - db: Drizzle 인스턴스 (single source of truth)
 * - credentialsRepo: safeStorage 기반 자격증명
 * - auth: KIS 토큰 발급/캐시
 * - httpByEnv: env별 KIS HTTP 클라이언트 (MOCK/PROD 각각 base URL)
 * - currentEnv: 현재 활성 환경 (메인 프로세스 싱글턴 상태)
 * - setCurrentEnv: 활성 환경 전환 (UI 확인 다이얼로그 이후만 호출)
 */
export interface Context {
  db: Db;
  credentialsRepo: CredentialsRepo;
  auth: AuthService;
  httpByEnv: Record<AppEnv, KisHttpClient>;
  currentEnv: AppEnv | null;
  setCurrentEnv: (env: AppEnv | null) => void;
}

/**
 * 컨텍스트 팩토리 — 앱 초기화 시 의존성을 한 번 생성하고,
 * tRPC 핸들러 호출 시 동일 객체를 반환.
 */
export function createContextFactory(deps: Omit<Context, 'setCurrentEnv' | 'currentEnv'>): {
  create: () => Context;
  setEnv: (env: AppEnv | null) => void;
} {
  let currentEnv: AppEnv | null = null;
  const setCurrentEnv = (env: AppEnv | null): void => {
    currentEnv = env;
  };
  return {
    create: () => ({
      ...deps,
      get currentEnv() {
        return currentEnv;
      },
      setCurrentEnv,
    }),
    setEnv: setCurrentEnv,
  };
}
