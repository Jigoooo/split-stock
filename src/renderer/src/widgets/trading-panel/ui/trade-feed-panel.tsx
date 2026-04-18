import type { ReactElement } from 'react';
import type { LiveTick } from '../model/use-live-feed';

export interface TradeFeedPanelProps {
  feed: LiveTick[];
}

/**
 * 체결창 — 최근 N건 tick을 시간 역순(신규 위)로 표시.
 * 한국식 색상: 상승 방향 체결 = 빨강, 하락 = 파랑.
 */
export const TradeFeedPanel = (props: TradeFeedPanelProps): ReactElement => {
  const { feed } = props;
  if (feed.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">체결</div>
        <div className="panel__body muted">체결 대기 중…</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel__title">체결 (최근 {feed.length}건)</div>
      <table className="hts-table" aria-label="체결창">
        <thead>
          <tr>
            <th style={{ width: '24%' }}>시각</th>
            <th className="num">체결가</th>
            <th className="num">수량</th>
            <th className="num">누적</th>
          </tr>
        </thead>
        <tbody>
          {feed.map((t) => {
            const color =
              t.tickDirection === 'UP' || t.tickDirection === 'UPPER_LIMIT'
                ? 'num-up'
                : t.tickDirection === 'DOWN' || t.tickDirection === 'LOWER_LIMIT'
                  ? 'num-down'
                  : 'num-flat';
            return (
              <tr key={`${t.time}-${t.accumVolume}`}>
                <td className="num">{formatTime(t.time)}</td>
                <td className={`num ${color}`}>{t.price.toLocaleString('ko-KR')}</td>
                <td className="num">{t.volume.toLocaleString('ko-KR')}</td>
                <td className="num muted">{t.accumVolume.toLocaleString('ko-KR')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function formatTime(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
}
