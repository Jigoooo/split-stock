import { trpc } from '@renderer/shared/api/trpc';
import {
  formatDateTimeLongKo,
  formatTimeOnly,
  thousandSeparator,
} from '@renderer/shared/lib/formatter';
import { TableGrid } from '@renderer/shared/ui';
import type { ReactElement } from 'react';

export interface FilledPaneProps {
  selectedPdno: string | null;
}

const FILLED_PANE_COLS = {
  time: '11.2rem',
  symbol: '9rem',
  side: '6.4rem',
  quantity: '9.6rem',
  price: '11rem',
  status: '8.8rem',
} as const;

/**
 * L2 "실시간 체결" 탭 — 내 계좌의 체결된 주문 확인용.
 *
 * 시장 전체 tick 피드(useTradeFeed) 와 구분된다:
 *   - TradingPanel 의 "실시간 체결" 탭은 시장 tick (남의 체결 포함)
 *   - 이 탭(MainPositionsPane)은 "내 주문이 체결됐는지" 확인 목적
 *
 * 데이터 소스: orders 테이블 (FILLED / PARTIAL 상태, 활성 계좌)
 *   - selectedPdno 없음 → 전체 체결
 *   - selectedPdno 있음 → 해당 종목 체결만 필터
 *
 * KIS CNI 체결통보 또는 balance-sync 로 orders 상태가 갱신되면 자동 refetch.
 * refetchInterval 3초로 폴링 기반 보강 — WebSocket 이 끊겨도 최종 일관성 확보.
 */
export const FilledPane = ({ selectedPdno }: FilledPaneProps): ReactElement => {
  const query = trpc.order.listMyFills.useQuery(
    { pdno: selectedPdno ?? undefined, limit: 100 },
    { refetchInterval: 3000 },
  );

  const rows = query.data?.orders ?? [];
  const title = selectedPdno
    ? `내 체결 (${selectedPdno}) — 최근 ${thousandSeparator(rows.length)}건`
    : `내 체결 — 최근 ${thousandSeparator(rows.length)}건`;

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
        {title}
      </div>
      {query.isLoading && rows.length === 0 ? (
        <div className="panel__body muted">불러오는 중…</div>
      ) : query.error ? (
        <div className="panel__body">
          <span className="chip chip--down">{query.error.message}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel__body muted" style={{ fontSize: '1.05rem' }}>
          {selectedPdno ? '해당 종목의 체결 내역이 없습니다' : '체결 내역이 없습니다'}
        </div>
      ) : (
        <TableGrid.Root
          variant="hts"
          stickyHeader
          horizontalScroll
          aria-label="내 체결 목록"
          style={{ flex: 1, minHeight: 0 }}
        >
          <TableGrid.Header>
            <TableGrid.Cell width={FILLED_PANE_COLS.time} className="date-time-cell">
              시각
            </TableGrid.Cell>
            <TableGrid.Cell width={FILLED_PANE_COLS.symbol}>종목</TableGrid.Cell>
            <TableGrid.Cell width={FILLED_PANE_COLS.side}>구분</TableGrid.Cell>
            <TableGrid.Cell width={FILLED_PANE_COLS.quantity} numeric>
              수량
            </TableGrid.Cell>
            <TableGrid.Cell width={FILLED_PANE_COLS.price} numeric>
              가격
            </TableGrid.Cell>
            <TableGrid.Cell width={FILLED_PANE_COLS.status}>상태</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            {rows.map((row) => {
              const sideClass = row.side === 'BUY' ? 'num-up' : 'num-down';
              const t = row.filledAt ?? row.placedAt;
              return (
                <TableGrid.Row key={row.id}>
                  <TableGrid.Cell
                    width={FILLED_PANE_COLS.time}
                    className="muted date-time-cell"
                    title={formatDateTimeLongKo(t)}
                  >
                    {formatTimeOnly(t)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={FILLED_PANE_COLS.symbol}>{row.pdno}</TableGrid.Cell>
                  <TableGrid.Cell width={FILLED_PANE_COLS.side} className={sideClass}>
                    {row.side === 'BUY' ? '매수' : '매도'}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={FILLED_PANE_COLS.quantity} numeric>
                    {thousandSeparator(row.qty)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={FILLED_PANE_COLS.price} numeric>
                    {row.division === 'MARKET' ? '시장가' : thousandSeparator(row.price)}
                  </TableGrid.Cell>
                  <TableGrid.Cell width={FILLED_PANE_COLS.status}>
                    <span className={`chip ${row.status === 'FILLED' ? 'chip--up' : ''}`}>
                      {row.status === 'FILLED' ? '체결' : '부분체결'}
                    </span>
                  </TableGrid.Cell>
                </TableGrid.Row>
              );
            })}
          </TableGrid.Body>
        </TableGrid.Root>
      )}
    </div>
  );
};
