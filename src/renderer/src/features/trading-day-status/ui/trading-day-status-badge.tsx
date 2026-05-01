import { trpc } from '@renderer/shared/api/trpc';
import { formatDateOnly } from '@renderer/shared/lib/formatter';
import type { TradingDayVerdict } from '@shared/contracts';
import type { ReactElement } from 'react';

interface TradingDayStatusBadgeProps {
  accountId: number;
}

interface TradingDayStatusBadgeView {
  className: string;
  text: string;
  title: string;
}

const SOURCE_LABELS = {
  KRX_DOWNLOAD: 'KRX 다운로드 캘린더',
  MANUAL_IMPORT: '수동 등록 캘린더',
  BUNDLED: '앱 내장 캘린더',
  UNKNOWN: '캘린더 미확인',
} satisfies Record<TradingDayVerdict['source'], string>;

const REASON_LABELS: Record<string, string> = {
  REGULAR: '정규 개장',
  WEEKEND: '주말',
  KRX_HOLIDAY: 'KRX 휴장일',
  YEAR_END_MARKET_CLOSING: '연말 폐장',
  CALENDAR_MISSING: '캘린더 없음',
  INVALID_DATE: '잘못된 날짜',
};

function formatDate(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return formatDateOnly(new Date(year, month - 1, day));
}

function getReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export function getTradingDayStatusBadgeView(
  verdict: TradingDayVerdict,
): TradingDayStatusBadgeView {
  const state =
    verdict.source === 'UNKNOWN' || verdict.stale
      ? '거래일 확인불가'
      : verdict.openDay
        ? '오늘 거래일'
        : '오늘 휴장';
  const textParts = [state, verdict.kisVerified === false ? 'KIS 불일치' : null].filter(Boolean);
  const titleParts = [
    `날짜: ${formatDate(verdict.date)}`,
    `출처: ${SOURCE_LABELS[verdict.source]}`,
    `사유: ${getReasonLabel(verdict.reason)}`,
    verdict.sourceVersion ? `버전: ${verdict.sourceVersion}` : null,
    verdict.kisVerified === true ? 'KIS 검증됨' : null,
    verdict.kisVerified === false ? 'KIS 불일치' : null,
    verdict.stale ? '갱신 필요' : null,
  ].filter(Boolean);
  const className =
    verdict.source === 'UNKNOWN' || verdict.stale || !verdict.openDay
      ? 'chip chip--down trading-day-status-badge'
      : 'chip chip--live trading-day-status-badge';

  return {
    className,
    text: textParts.join(' · '),
    title: titleParts.join(' · '),
  };
}

export const TradingDayStatusBadge = ({ accountId }: TradingDayStatusBadgeProps): ReactElement => {
  const query = trpc.market.getTradingDayStatus.useQuery(
    { accountId },
    { refetchInterval: 60_000, staleTime: 30_000 },
  );

  if (query.isPending) {
    return (
      <span
        className="chip trading-day-status-badge"
        role="status"
        title="거래일 상태를 확인하는 중입니다."
      >
        거래일 확인 중
      </span>
    );
  }
  if (query.error || !query.data) {
    return (
      <span
        className="chip chip--down trading-day-status-badge"
        role="status"
        title="거래일 캘린더를 확인할 수 없습니다."
      >
        거래일 확인불가
      </span>
    );
  }

  const view = getTradingDayStatusBadgeView(query.data);

  return (
    <span className={view.className} role="status" title={view.title} aria-label={view.title}>
      {view.text}
    </span>
  );
};
