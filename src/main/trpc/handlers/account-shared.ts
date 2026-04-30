import type { AppEnv, Balance, BrokerError, KisError } from '@shared/contracts';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { ActiveAccountRepo } from '../../account/active-account';
import { repairStoredCredentialAccounts } from '../../account/repair-stored-accounts';
import type { Db } from '../../db/client';
import { orders as ordersTable } from '../../db/schema';
import type { EventLogger } from '../../logging/event-logger';
import type { CredentialsRepo } from '../../security/credentials-repo';
import { SELL_SETTLEMENT_GRACE_MS } from '../../trading/current-state-sync';

export function listAccountsWithActiveRepair(ctx: {
  activeAccounts: ActiveAccountRepo;
  credentialsRepo: CredentialsRepo;
  activeAccountId: number | null;
  currentEnv: AppEnv | null;
  logger: EventLogger;
  setEnvAndAccount: (next: { env: AppEnv | null; accountId: number | null }) => void;
}) {
  repairStoredCredentialAccounts(ctx);
  let accounts = ctx.activeAccounts.list();
  let activeAccountId = ctx.activeAccountId;
  const hasActiveRow = accounts.some((account) => account.isActive);
  if (accounts.length > 0 && (!hasActiveRow || activeAccountId === null)) {
    const repaired = ctx.activeAccounts.ensureActive();
    if (repaired.isOk()) {
      activeAccountId = repaired.value;
      const active = ctx.activeAccounts.getById(activeAccountId);
      ctx.setEnvAndAccount({
        env: active?.env ?? ctx.currentEnv,
        accountId: activeAccountId,
      });
      accounts = ctx.activeAccounts.list();
    }
  }

  return { accounts, activeAccountId };
}

export function toLegacyBalance(b: Balance) {
  return {
    positions: b.positions.map((h) => ({
      code: h.symbol,
      name: h.name,
      qty: h.qty,
      avgPrice: h.avgPrice,
      currentPrice: h.currentPrice,
      evalAmount: h.evalAmount,
      pnlAmount: h.pnlAmount,
      pnlRate: h.pnlRate,
    })),
    deposit: b.deposit,
    d2Deposit: b.d2Deposit,
    totalEval: b.totalEval,
    estimatedAsset: b.estimatedAsset,
  };
}

export function toLegacyKisError(e: BrokerError): KisError {
  const kind: KisError['kind'] =
    e.kind === 'BUSINESS' ? 'API_BUSINESS' : e.kind === 'NOT_IMPLEMENTED' ? 'UNKNOWN' : e.kind;
  return {
    kind,
    msg: e.msg,
    ...(e.raw?.code !== undefined && { rt_cd: e.raw.code }),
    ...(e.raw?.subCode !== undefined && { msg_cd: e.raw.subCode }),
    ...(e.cause !== undefined && { cause: e.cause }),
  };
}

export function serializeCause(cause: unknown): unknown {
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  return cause;
}

function balanceDiagnostic(e: KisError): string {
  const parts: string[] = [];
  const cause = e.cause as { status?: number; body?: string } | undefined;
  if (cause?.status !== undefined) parts.push(`HTTP ${cause.status}`);
  if (e.rt_cd) parts.push(`rt_cd=${e.rt_cd}`);
  if (e.msg_cd) parts.push(`msg_cd=${e.msg_cd}`);
  if (e.msg && !/^HTTP \d+$/.test(e.msg) && e.msg !== 'fetch failed') {
    parts.push(e.msg);
  }
  if (cause?.body) {
    const trimmed = cause.body.trim().replace(/\s+/g, ' ');
    if (trimmed.length > 0) parts.push(`body=${trimmed.slice(0, 160)}`);
  }
  return parts.length > 0 ? ` [${parts.join(' · ')}]` : '';
}

export function balanceErrorMessage(e: KisError): string {
  const diag = balanceDiagnostic(e);
  switch (e.kind) {
    case 'NETWORK':
      return `잔고 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.${diag}`;
    case 'RATE_LIMITED':
      return `잔고조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.${diag}`;
    case 'AUTH_FAILED':
      return `토큰이 만료되었거나 자격증명이 잘못되었습니다. 다시 로그인 해주세요.${diag}`;
    case 'VALIDATION':
      return `잔고 응답 형식이 예상과 다릅니다. KIS 공지를 확인해주세요.${diag}`;
    case 'API_BUSINESS':
      return `${e.msg || '잔고조회 중 오류가 발생했습니다.'}${diag}`;
    default:
      return `잔고조회에 실패했습니다.${diag}`;
  }
}

export function readRecentSellOrderPdnos(db: Db, accountId: number): Set<string> {
  const cutoff = new Date(Date.now() - SELL_SETTLEMENT_GRACE_MS);
  const rows = db
    .select({ pdno: ordersTable.pdno })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.accountId, accountId),
        eq(ordersTable.side, 'SELL'),
        inArray(ordersTable.status, ['PENDING', 'PARTIAL', 'FILLED']),
        or(gte(ordersTable.placedAt, cutoff), gte(ordersTable.filledAt, cutoff)),
      ),
    )
    .all();
  return new Set(rows.map((row) => row.pdno));
}
