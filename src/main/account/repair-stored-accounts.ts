import type { EventLogger } from '../logging/event-logger';
import type { CredentialsRepo } from '../security/credentials-repo';
import type { ActiveAccountRepo } from './active-account';

export interface StoredAccountRepairDeps {
  activeAccounts: ActiveAccountRepo;
  credentialsRepo: CredentialsRepo;
  logger: EventLogger;
}

/**
 * credentials.account_id 는 남아 있는데 accounts 행만 누락된 복원/마이그레이션 상태를 복구한다.
 * 계좌 ID 를 새로 만들면 lots/settings/credentials 참조가 깨지므로 반드시 기존 accountId 로 재생성한다.
 */
export function repairAccountFromStoredCredentials(
  deps: StoredAccountRepairDeps,
  accountId: number,
): boolean {
  if (deps.activeAccounts.getById(accountId)) return true;

  const cred = deps.credentialsRepo.loadCredentials(accountId);
  if (cred.isErr() || !cred.value) {
    deps.logger.log({
      level: 'WARN',
      category: 'AUTH',
      message: 'account.repair.credentials.unavailable',
      payload: {
        accountId,
        reason: cred.isErr() ? cred.error.kind : 'NOT_FOUND',
      },
    });
    return false;
  }

  const result = deps.activeAccounts.ensureFromStoredCredentials({
    accountId,
    env: cred.value.env,
    broker: cred.value.broker,
    accountNo8: cred.value.accountNo8,
    accountProdCd: cred.value.accountProdCd,
  });
  if (result.isErr()) {
    deps.logger.log({
      level: 'ERROR',
      category: 'AUTH',
      message: 'account.repair.failed',
      payload: {
        accountId,
        env: cred.value.env,
        broker: cred.value.broker,
        reason: result.error.kind,
      },
    });
    return false;
  }

  deps.logger.log({
    level: 'WARN',
    category: 'AUTH',
    message: 'account.repaired.from.credentials',
    payload: { accountId, env: cred.value.env, broker: cred.value.broker },
  });
  return true;
}

export function repairStoredCredentialAccounts(deps: StoredAccountRepairDeps): void {
  for (const entry of deps.credentialsRepo.listEntries()) {
    if (deps.activeAccounts.getById(entry.accountId)) continue;
    repairAccountFromStoredCredentials(deps, entry.accountId);
  }
}
