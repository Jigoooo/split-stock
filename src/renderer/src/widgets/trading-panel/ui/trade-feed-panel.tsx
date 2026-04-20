import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { useFlashOnNew } from '@renderer/shared/lib/use-flash-on-new';
import type { ReactElement } from 'react';
import type { LiveTick } from '../model/use-live-feed';

function flashKindFromTick(direction: LiveTick['tickDirection']): 'up' | 'down' | undefined {
  if (direction === 'UP' || direction === 'UPPER_LIMIT') return 'up';
  if (direction === 'DOWN' || direction === 'LOWER_LIMIT') return 'down';
  return undefined;
}

export interface TradeFeedPanelProps {
  feed: LiveTick[];
  name?: string;
  pdno?: string;
}

/**
 * 실시간 체결 — 최근 N건 tick을 시간 역순(신규 위)로 표시.
 * 한국식 색상: 상승 방향 체결 = 빨강, 하락 = 파랑.
 */
export const TradeFeedPanel = (props: TradeFeedPanelProps): ReactElement => {
  const { feed, name, pdno } = props;
  const headerSuffix = name && pdno ? ` — ${name} (${pdno})` : '';
  const flashSet = useFlashOnNew(feed, (t) => `${t.time}-${t.accumVolume}`);
  if (feed.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">실시간 체결{headerSuffix}</div>
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          실시간 체결 수신 대기…
        </div>
      </div>
    );
  }
  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div className="panel__title" style={{ flexShrink: 0 }}>
        실시간 체결{headerSuffix} (최근 {thousandSeparator(feed.length)}건)
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <table
          className="hts-table"
          aria-label="실시간 체결"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            <col style={{ width: '24%' }} />
            <col />
            <col />
            <col />
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th>시각</th>
              <th className="num">체결가</th>
              <th className="num">수량</th>
              <th className="num">누적</th>
            </tr>
          </thead>
        </table>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table
            className="hts-table"
            aria-label="실시간 체결 바디"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              <col style={{ width: '24%' }} />
              <col />
              <col />
              <col />
            </colgroup>
            <tbody>
              {feed.map((t) => {
                const color =
                  t.tickDirection === 'UP' || t.tickDirection === 'UPPER_LIMIT'
                    ? 'num-up'
                    : t.tickDirection === 'DOWN' || t.tickDirection === 'LOWER_LIMIT'
                      ? 'num-down'
                      : 'num-flat';
                const key = `${t.time}-${t.accumVolume}`;
                const flashKind = flashSet.has(key)
                  ? flashKindFromTick(t.tickDirection)
                  : undefined;
                return (
                  <tr key={key} data-flash={flashKind}>
                    <td className="num">{formatTime(t.time)}</td>
                    <td className={`num ${color}`}>{thousandSeparator(t.price)}</td>
                    <td className="num">{thousandSeparator(t.volume)}</td>
                    <td className="num muted">{thousandSeparator(t.accumVolume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

function formatTime(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
}
