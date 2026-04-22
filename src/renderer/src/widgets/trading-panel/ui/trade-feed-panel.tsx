import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { useFlashOnNew } from '@renderer/shared/lib/use-flash-on-new';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import type { LiveTick } from '../model/use-live-feed';

const TRADE_FEED_COLUMN_WIDTHS = {
  time: 100,
  price: 112,
  volume: 104,
  accumVolume: 200,
} as const;

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
      <TableGrid.Root
        variant="hts"
        stickyHeader
        horizontalScroll
        aria-label="실시간 체결"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.time}>시각</TableGrid.Cell>
          <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.price} numeric>
            체결가
          </TableGrid.Cell>
          <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.volume} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.accumVolume} numeric>
            누적
          </TableGrid.Cell>
        </TableGrid.Header>
        <TableGrid.Body>
          {feed.map((t) => {
            const colorClass =
              t.tickDirection === 'UP' || t.tickDirection === 'UPPER_LIMIT'
                ? 'num-up'
                : t.tickDirection === 'DOWN' || t.tickDirection === 'LOWER_LIMIT'
                  ? 'num-down'
                  : 'num-flat';
            const key = `${t.time}-${t.accumVolume}`;
            const flashKind = flashSet.has(key) ? flashKindFromTick(t.tickDirection) : null;
            return (
              <TableGrid.Row key={key} flash={flashKind ?? null}>
                <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.time} numeric>
                  {formatTime(t.time)}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={TRADE_FEED_COLUMN_WIDTHS.price}
                  numeric
                  className={colorClass}
                >
                  {thousandSeparator(t.price)}
                </TableGrid.Cell>
                <TableGrid.Cell width={TRADE_FEED_COLUMN_WIDTHS.volume} numeric>
                  {thousandSeparator(t.volume)}
                </TableGrid.Cell>
                <TableGrid.Cell
                  width={TRADE_FEED_COLUMN_WIDTHS.accumVolume}
                  numeric
                  className="muted"
                >
                  {thousandSeparator(t.accumVolume)}
                </TableGrid.Cell>
              </TableGrid.Row>
            );
          })}
        </TableGrid.Body>
      </TableGrid.Root>
    </div>
  );
};

function formatTime(hhmmss: string): string {
  if (hhmmss.length !== 6) return hhmmss;
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
}
