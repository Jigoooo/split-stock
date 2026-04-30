import type { EventLogger } from '../../logging/event-logger';
import type { ApiContextDiagnostic } from '../auto-discovery';
import type { MarketContextSnapshot } from '../market-context-service';
import type { RankedMarketContext } from './types';

export async function safeContextFetch<T>(
  fn: () => Promise<T>,
  logger: EventLogger,
  label: string,
  onFailure?: (reason: string) => void,
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    onFailure?.(reason);
    logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.context.fetch-failed',
      payload: { source: label, reason },
    });
    if (label === 'naver-news' || label === 'naver-datalab') {
      return new Map() as T;
    }
    return null as T;
  }
}

export function mergeDiagnostics(
  existing: ReadonlyArray<ApiContextDiagnostic>,
  additions: ReadonlyArray<ApiContextDiagnostic>,
): ApiContextDiagnostic[] {
  const out = [...existing];
  for (const item of additions) {
    const index = out.findIndex(
      (current) => current.source === item.source && current.status === item.status,
    );
    if (index < 0) {
      out.push(item);
      continue;
    }
    const current = out[index];
    if (!current) continue;
    out[index] = {
      ...current,
      count: (current.count ?? 0) + (item.count ?? 0),
      ...((current.reason ?? item.reason) !== undefined
        ? { reason: current.reason ?? item.reason ?? null }
        : {}),
      ...((current.stale ?? item.stale) !== undefined
        ? { stale: Boolean(current.stale || item.stale) }
        : {}),
    };
  }
  return out;
}

export function diagnosticsFromMarketContext(
  snapshot: MarketContextSnapshot,
): ApiContextDiagnostic[] {
  return [
    {
      source: 'krx',
      status: snapshot.status.krx.lastError
        ? snapshot.krxByPdno.size > 0
          ? 'cache'
          : 'failed'
        : snapshot.krxByPdno.size > 0
          ? 'used'
          : 'skipped',
      count: snapshot.krxByPdno.size,
      stale: snapshot.status.krx.isStale,
      reason: snapshot.status.krx.lastError,
    },
    {
      source: 'ecos',
      status: snapshot.status.ecos.lastError
        ? snapshot.ecos.length > 0
          ? 'cache'
          : 'failed'
        : snapshot.ecos.length > 0
          ? 'used'
          : 'skipped',
      count: snapshot.ecos.length,
      stale: snapshot.status.ecos.isStale,
      reason: snapshot.status.ecos.lastError,
    },
  ];
}

export function buildRankedMarketContext(
  pdno: string,
  snapshot: MarketContextSnapshot | null,
): RankedMarketContext | null {
  if (!snapshot) return null;
  const krx = snapshot.krxByPdno.get(pdno);
  const ecos = snapshot.ecos.map((p) => ({
    indicator: p.indicator,
    date: p.date,
    value: p.value,
    unitName: p.unitName,
  }));
  if (!krx && ecos.length === 0) return null;
  return {
    krx: krx
      ? {
          date: krx.date,
          close: krx.close,
          changeRate: krx.changeRate,
          volume: krx.volume,
          tradeValue: krx.tradeValue,
          marketCap: krx.marketCap,
        }
      : null,
    ecos,
    status: {
      krx: {
        isAvailable: snapshot.status.krx.isAvailable,
        isStale: snapshot.status.krx.isStale,
        lastError: snapshot.status.krx.lastError,
      },
      ecos: {
        isAvailable: snapshot.status.ecos.isAvailable,
        isStale: snapshot.status.ecos.isStale,
        lastError: snapshot.status.ecos.lastError,
      },
    },
  };
}

export function formatMarketContextForPrompt(
  pdno: string,
  snapshot: MarketContextSnapshot | null,
): string | null {
  const context = buildRankedMarketContext(pdno, snapshot);
  if (!context) return null;
  const parts: string[] = [];
  if (context.krx) {
    parts.push(
      [
        `KRX date=${context.krx.date}`,
        context.krx.close !== null ? `close=${context.krx.close}` : null,
        context.krx.changeRate !== null ? `changeRate=${context.krx.changeRate}%` : null,
        context.krx.marketCap !== null ? `marketCap=${context.krx.marketCap}` : null,
        context.krx.volume !== null ? `volume=${context.krx.volume}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(', '),
    );
  }
  if (context.ecos.length > 0) {
    parts.push(
      `ECOS ${context.ecos
        .map((p) => `${p.indicator}=${p.value}${p.unitName ? p.unitName : ''}@${p.date}`)
        .join(', ')}`,
    );
  }
  const staleFlags = [
    context.status.krx.isStale ? 'KRX stale' : null,
    context.status.ecos.isStale ? 'ECOS stale' : null,
    context.status.krx.lastError ? `KRX error=${context.status.krx.lastError}` : null,
    context.status.ecos.lastError ? `ECOS error=${context.status.ecos.lastError}` : null,
  ].filter((v): v is string => v !== null);
  if (staleFlags.length > 0) parts.push(`status: ${staleFlags.join(' / ')}`);
  return parts.join(' | ');
}
