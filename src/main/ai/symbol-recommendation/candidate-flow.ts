import type { AutoDiscoveredCandidate } from '../auto-discovery';
import { buildCandidatePool, type CandidateEntry } from '../build-candidate-pool';
import type { SuggestSymbolsInput } from './types';

export function buildPool(
  input: SuggestSymbolsInput,
  includeAutoDiscovery: boolean,
  autoCandidates?: AutoDiscoveredCandidate[],
): CandidateEntry[] {
  return buildCandidatePool({
    db: input.db,
    accountId: input.accountId,
    cap: input.poolCap ?? 30,
    candlesRepo: input.candlesRepo,
    includeAutoDiscovery,
    ...(autoCandidates !== undefined ? { autoCandidates } : {}),
    ...(input.extraPdnos && input.extraPdnos.length > 0 ? { extraPdnos: input.extraPdnos } : {}),
  });
}

export function dedupeCandidates(items: ReadonlyArray<CandidateEntry>): CandidateEntry[] {
  const out: CandidateEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.pdno)) continue;
    seen.add(item.pdno);
    out.push(item);
  }
  return out;
}
