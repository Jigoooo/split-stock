import { trpc } from '@renderer/shared/api/trpc';
import type { ReactElement } from 'react';

interface TradingDayStatusBadgeProps {
  accountId: number;
}

export const TradingDayStatusBadge = ({ accountId }: TradingDayStatusBadgeProps): ReactElement => {
  const query = trpc.market.getTradingDayStatus.useQuery(
    { accountId },
    { refetchInterval: 60_000, staleTime: 30_000 },
  );

  if (query.isPending) {
    return <span className="chip">거래일 확인 중</span>;
  }
  if (query.error || !query.data) {
    return (
      <span className="chip chip--down" role="status">
        확인불가 · 캘린더 갱신 필요
      </span>
    );
  }

  const verdict = query.data;
  const state =
    verdict.source === 'UNKNOWN' || verdict.stale
      ? '확인불가'
      : verdict.openDay
        ? '거래일'
        : '휴장';
  const parts = [
    state,
    verdict.source === 'UNKNOWN' ? '캘린더 갱신 필요' : verdict.source,
    verdict.kisVerified === true ? 'KIS 검증됨' : null,
    verdict.kisVerified === false ? 'KIS 불일치' : null,
    !verdict.openDay && verdict.reason ? verdict.reason : null,
  ].filter(Boolean);
  const className =
    verdict.source === 'UNKNOWN' || verdict.stale || !verdict.openDay
      ? 'chip chip--down'
      : 'chip chip--live';

  return (
    <span className={className} role="status" title={verdict.reason}>
      {parts.join(' · ')}
    </span>
  );
};
