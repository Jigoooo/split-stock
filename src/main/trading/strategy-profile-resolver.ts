import type { StrategyProfile } from '@shared/contracts';
import type { StrategyRepo } from './strategy-repo';

export function resolveStrategyProfile(
  repo: StrategyRepo,
  accountId: number,
  pdno: string,
): StrategyProfile | null {
  const active = repo.getActive(accountId, pdno);
  if (active.isOk() && active.value !== null) return active.value;
  const global = repo.getActive(accountId, null);
  if (global.isOk() && global.value !== null) return global.value;
  return null;
}
